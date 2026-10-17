import { useEffect, useId, useRef, useState } from 'react'

import { Button, Callout, Input, PlusIcon, tv } from '@quill/ui'
import { EMOJI_NAME_PATTERN, type TokenMap } from '@quill/theme'

import type { OrganisationSettings } from '../../lib/api/index.ts'
import {
  EMOJI_ACCEPT,
  EMOJI_MAX_BYTES,
  EMOJI_MAX_FRAMES,
  EMOJI_MAX_SECONDS,
  EMOJI_TYPE_NAMES,
  useUploadEmojiImage,
} from '../../lib/api/emoji.ts'
import { useCustomProperty } from '../../lib/dom/use-custom-property.ts'
import { readAnimationFrames, type AnimationFrames } from '../../lib/media/animation-frames.ts'
import { EmojiImage, type ServedEmoji } from './emoji-image.tsx'
import { PosterFrame } from './poster-frame.tsx'

export type { ServedEmoji } from './emoji-image.tsx'

export type CustomEmojiList = NonNullable<OrganisationSettings['emoji']>
type CustomEmoji = CustomEmojiList[number]

/** As many as the settings file holds (`MAX_CUSTOM_EMOJI`). */
const MAX_EMOJI = 100

/** An emoji is drawn at text size; a larger image is recorded at this size, in proportion. */
const MAX_PIXELS = 1024

const EMOJI_NAME = new RegExp(EMOJI_NAME_PATTERN, 'u')

/** "PNG, JPEG or SVG". */
function listed(names: readonly string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`
}

/** What the picker takes, as a person would list it. */
const ACCEPTED_TYPES = `${listed(Object.values(EMOJI_TYPE_NAMES))}, up to ${String(EMOJI_MAX_BYTES / 1024)} KB`

const emojiStyles = tv({
  slots: {
    root: '@container m-0 flex flex-col gap-3 border-0 p-0',
    // The screen's own heading shows the name; the legend gives the fields it groups.
    legend: 'sr-only',
    intro: 'text-xs leading-normal text-muted',
    list: 'm-0 flex list-none flex-col gap-2 p-0',
    item: 'flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-3',
    header: 'flex items-center gap-3',
    glyph: 'size-8 shrink-0 object-contain',
    identity: 'flex min-w-0 grow flex-col gap-0.5',
    name: 'truncate font-mono text-xs text-foreground',
    facts: 'text-2xs text-muted',
    previews: 'flex flex-wrap gap-2',
    adder: 'flex flex-col items-start gap-3',
    field: 'flex w-full flex-col gap-1',
    label: 'text-xs font-medium text-foreground',
    chooser: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1',
    // Wraps rather than truncates: the types it lists are the help, and a long file name is still read whole.
    chosen: 'min-w-40 flex-1 text-xs text-muted wrap-anywhere',
    help: 'text-2xs leading-normal text-muted',
    caption: 'basis-full text-2xs text-muted',
    full: 'text-xs text-muted',
  },
})

/**
 * A sentence as a reader in one scheme sees it, with the emoji at the size
 * and on the baseline the reading stylesheet sets. Painted through custom
 * properties, which the CSP allows where a `style` attribute is refused.
 */
const sampleStyles = tv({
  slots: {
    page: [
      'inline-flex items-center gap-2 rounded-md border border-border bg-(--preview-page) px-2.5 py-1.5',
    ],
    scheme: 'text-2xs text-(--preview-muted)',
    sentence: 'text-sm whitespace-nowrap text-(--preview-ink)',
    image: 'inline-block h-[1.2em] w-auto align-[-0.22em]',
  },
})

interface EmojiSampleProps {
  readonly scheme: 'light' | 'dark'
  readonly name: string
  readonly image: ServedEmoji
  readonly page: TokenMap
}

function EmojiSample({ scheme, name, image, page }: EmojiSampleProps) {
  const styles = sampleStyles()
  return (
    <span
      ref={useCustomProperty('--preview-page', page['--palette-background'])}
      className={styles.page()}
    >
      <span
        ref={useCustomProperty('--preview-muted', page['--palette-muted'])}
        className={styles.scheme()}
      >
        {scheme === 'light' ? 'Light' : 'Dark'}
      </span>
      <span
        ref={useCustomProperty('--preview-ink', page['--palette-body'])}
        className={styles.sentence()}
      >
        Inline with text <EmojiImage className={styles.image()} image={image} alt={`:${name}:`} />{' '}
        like this
      </span>
    </span>
  )
}

/** What is wrong with an emoji's name, in words a form can show; undefined when nothing. */
export function emojiNameProblem(name: string, others: readonly string[]): string | undefined {
  if (!EMOJI_NAME.test(name)) {
    return 'Use a lower-case letter, then letters, digits, hyphens or underscores (up to 32).'
  }
  if (others.includes(name)) return `There is already an emoji called “${name}”.`
  return undefined
}

/** A name to start from, taken from the file's: `Acme logo.svg` becomes `acme_logo`. */
export function nameFromFile(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]*$/u, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/gu, '_')
    .replaceAll(/^[^a-z]+|_+$/gu, '')
  return stem.slice(0, 32)
}

/**
 * The image's own size, for its proportions, at most `MAX_PIXELS` on its
 * longer side. An image the browser cannot measure — an SVG with no size of
 * its own — is taken as square, which is what an icon almost always is.
 */
async function measure(src: string): Promise<{ width: number; height: number }> {
  const image = new Image()
  image.src = src
  try {
    await image.decode()
  } catch {
    // Undecodable here is not a reason to refuse: the server has the bytes,
    // and a square is the proportion an emoji almost always has.
  }
  const width = image.naturalWidth > 0 ? image.naturalWidth : 64
  const height = image.naturalHeight > 0 ? image.naturalHeight : 64
  const scale = Math.min(1, MAX_PIXELS / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export interface EmojiEditorProps {
  readonly emoji: OrganisationSettings['emoji']
  /** Where each saved emoji is served, and its still, by name, as the server names them. */
  readonly served: ReadonlyMap<string, ServedEmoji>
  readonly light: TokenMap
  readonly dark: TokenMap
  readonly onEmojiChange: (emoji: CustomEmojiList | undefined) => void
  /** How a chosen file's frames are read for its poster frame; the browser's own unless a test gives another. */
  readonly readFrames?: (file: File) => Promise<AnimationFrames | undefined>
}

/**
 * What a saved emoji is, as its list item states it: "GIF, animated · 12
 * frames, 1.2 s", or for an animation with no still yet (WebP, AVIF) that it
 * plays as uploaded, which is the image pipeline's to change (ADR-047).
 */
function emojiFacts(entry: CustomEmoji): string {
  const type = EMOJI_TYPE_NAMES[entry.mediaType]
  if (entry.still === undefined) {
    return entry.frames === undefined ? type : `${type}, animated, plays as uploaded`
  }
  if (entry.frames === undefined || entry.milliseconds === undefined) return `${type}, animated`
  const seconds = (entry.milliseconds / 1000).toFixed(1)
  return `${type}, animated · ${String(entry.frames)} frames, ${seconds} s`
}

/**
 * The organisation's own emoji (ADR-038): `:acme:` in a document, drawn as
 * an image uploaded here — its logo as the SVG the brand guide ships, a
 * partner's, a team's mascot. Each one is previewed at text size, in a
 * sentence, in light and in dark, because an emoji that only works on one of
 * them is the commonest way for one to go wrong. An animation is previewed
 * moving and still, labelled, because a reader who asks for less motion sees
 * the still (ADR-047).
 *
 * An upload stores the image and nothing else; the emoji exists once the
 * settings are saved, with the rest of the page.
 */
export function EmojiEditor({
  emoji,
  served,
  light,
  dark,
  onEmojiChange,
  readFrames = readAnimationFrames,
}: EmojiEditorProps) {
  const entries = emoji ?? []
  const styles = emojiStyles()
  // Images chosen on this visit are shown from the file itself, because the
  // server serves only an emoji that has been saved.
  const [local, setLocal] = useState<ReadonlyMap<string, ServedEmoji>>(new Map())
  const created = useRef<string[]>([])
  // Synchronises with the browser's object-URL registry: every preview URL
  // this form created is released when the form goes away.
  useEffect(
    () => () => {
      for (const url of created.current) URL.revokeObjectURL(url)
    },
    [],
  )

  const sourceOf = (entry: CustomEmoji): ServedEmoji | undefined => {
    const chosen = local.get(entry.hash)
    if (chosen !== undefined) return chosen
    const saved = served.get(entry.name)
    return saved?.src.includes(entry.hash.slice(0, 16)) === true ? saved : undefined
  }

  function replace(next: CustomEmojiList) {
    onEmojiChange(next.length === 0 ? undefined : next)
  }

  return (
    <fieldset className={styles.root()}>
      <legend className={styles.legend()}>Emoji</legend>
      <p className={styles.intro()}>
        Your organisation’s own emoji, such as its logo as an SVG. Write <code>:name:</code> in a
        document. GitHub’s shortcodes, such as <code>:+1:</code>, work without setting anything up.
        A label with the same name as an emoji shows it in place of its dot.
      </p>

      {entries.length === 0 ? undefined : (
        <ul className={styles.list()}>
          {entries.map((entry) => {
            const image = sourceOf(entry)
            const still = image?.still
            return (
              <li key={entry.name} className={styles.item()}>
                <div className={styles.header()}>
                  {image === undefined ? undefined : (
                    <EmojiImage className={styles.glyph()} image={image} alt="" />
                  )}
                  <div className={styles.identity()}>
                    <code className={styles.name()}>:{entry.name}:</code>
                    <span className={styles.facts()}>
                      {emojiFacts(entry)} · {entry.width} × {entry.height}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove the emoji :${entry.name}:`}
                    onClick={() => {
                      replace(entries.filter((other) => other.name !== entry.name))
                    }}
                  >
                    Remove
                  </Button>
                </div>
                {image === undefined ? undefined : (
                  <div
                    className={styles.previews()}
                    role="group"
                    aria-label={`Preview of :${entry.name}: at text size`}
                  >
                    <EmojiSample scheme="light" name={entry.name} image={image} page={light} />
                    <EmojiSample scheme="dark" name={entry.name} image={image} page={dark} />
                  </div>
                )}
                {still === undefined ? undefined : (
                  <div
                    className={styles.previews()}
                    role="group"
                    aria-label={`Preview of :${entry.name}: still, for reduced motion`}
                  >
                    <EmojiSample
                      scheme="light"
                      name={entry.name}
                      image={{ src: still }}
                      page={light}
                    />
                    <EmojiSample
                      scheme="dark"
                      name={entry.name}
                      image={{ src: still }}
                      page={dark}
                    />
                    <p className={styles.caption()}>
                      Still, as readers who ask for less motion see it.
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {entries.length >= MAX_EMOJI ? (
        <p className={styles.full()}>An organisation holds at most {MAX_EMOJI} emoji.</p>
      ) : (
        <EmojiAdder
          existing={entries.map((entry) => entry.name)}
          readFrames={readFrames}
          onAdd={(entry, image) => {
            created.current.push(image.src, ...(image.still === undefined ? [] : [image.still]))
            setLocal((current) => new Map([...current, [entry.hash, image]]))
            replace([...entries, entry])
          }}
        />
      )}
    </fieldset>
  )
}

interface EmojiAdderProps {
  readonly existing: readonly string[]
  readonly readFrames: (file: File) => Promise<AnimationFrames | undefined>
  /** The entry, and its preview from the file itself (with its chosen poster) until it is served. */
  readonly onAdd: (entry: CustomEmoji, preview: ServedEmoji) => void
}

function EmojiAdder({ existing, readFrames, onAdd }: EmojiAdderProps) {
  // Plain fields, not a settings draft: they hold an emoji on its way into
  // the settings, have no revision, and are never saved on their own.
  const [file, setFile] = useState<File | undefined>(undefined)
  const [name, setName] = useState('')
  const [tooLarge, setTooLarge] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const id = useId()
  const upload = useUploadEmojiImage()
  const styles = emojiStyles()
  const problem = name === '' ? undefined : emojiNameProblem(name, existing)
  // An animation's frames, as the browser reads them, and the poster chosen
  // among them (ADR-047): the first unless another is chosen.
  const [frames, setFrames] = useState<AnimationFrames | undefined>(undefined)
  const [poster, setPoster] = useState(0)
  const [posterPreview, setPosterPreview] = useState<string | undefined>(undefined)
  // The latest of each, for the asynchronous answers to check they still apply.
  const current = useRef<{
    file: File | undefined
    frames: AnimationFrames | undefined
    poster: number
    preview: string | undefined
  }>({ file: undefined, frames: undefined, poster: 0, preview: undefined })
  // Synchronises with the browser's decoder and object-URL registry: what
  // this form holds is let go when it goes away.
  useEffect(
    () => () => {
      current.current.frames?.close()
      if (current.current.preview !== undefined) URL.revokeObjectURL(current.current.preview)
    },
    [],
  )

  function showPreview(url: string | undefined) {
    if (current.current.preview !== undefined) URL.revokeObjectURL(current.current.preview)
    current.current.preview = url
    setPosterPreview(url)
  }

  function choosePoster(index: number, of: AnimationFrames) {
    current.current.poster = index
    setPoster(index)
    void of.frame(index).then((blob) => {
      if (current.current.frames === of && current.current.poster === index) {
        showPreview(URL.createObjectURL(blob))
      }
    })
  }

  function letGoOfFrames() {
    current.current.frames?.close()
    current.current.frames = undefined
    current.current.poster = 0
    setFrames(undefined)
    setPoster(0)
    showPreview(undefined)
  }

  function choose(chosen: File | undefined) {
    upload.reset()
    setFile(chosen)
    setTooLarge(chosen !== undefined && chosen.size > EMOJI_MAX_BYTES)
    if (chosen !== undefined && name === '') setName(nameFromFile(chosen.name))
    letGoOfFrames()
    current.current.file = chosen
    if (chosen === undefined) return
    void readFrames(chosen).then((read) => {
      if (read === undefined) return
      if (current.current.file !== chosen) {
        read.close()
        return
      }
      current.current.frames = read
      setFrames(read)
      choosePoster(0, read)
    })
  }

  /** The chosen poster frame, uploaded as the still, when it is not the first. */
  async function uploadPoster(): Promise<Partial<CustomEmoji>> {
    if (frames === undefined || poster === 0) return {}
    const drawn = await frames.frame(poster)
    const cut = await upload.mutateAsync(
      new File([drawn], `${name}-poster.png`, { type: 'image/png' }),
    )
    return { still: cut.hash, stillType: 'image/png', poster }
  }

  async function add(chosen: File) {
    let entry: CustomEmoji
    try {
      const { hash, mediaType, ...animation } = await upload.mutateAsync(chosen)
      entry = {
        name,
        hash,
        mediaType,
        ...animation,
        ...(await uploadPoster()),
        width: 0,
        height: 0,
      }
    } catch {
      // The upload's own error is shown below the form.
      return
    }
    const src = URL.createObjectURL(chosen)
    const size = await measure(src)
    const still = entry.poster === undefined ? undefined : posterPreview
    onAdd({ ...entry, ...size }, { src, ...(still === undefined ? {} : { still }) })
    // The poster's preview now belongs to the saved emoji's.
    if (still !== undefined) current.current.preview = undefined
    letGoOfFrames()
    current.current.file = undefined
    setFile(undefined)
    setName('')
    if (picker.current !== null) picker.current.value = ''
  }

  return (
    <div className={styles.adder()}>
      <div className={styles.field()}>
        <span className={styles.label()} id={`${id}-label`}>
          Image
        </span>
        <input
          ref={picker}
          type="file"
          accept={EMOJI_ACCEPT}
          hidden
          aria-labelledby={`${id}-label`}
          onChange={(event) => {
            choose(event.target.files?.[0])
          }}
        />
        <div className={styles.chooser()}>
          <Button
            size="sm"
            variant="secondary"
            aria-describedby={`${id}-chosen`}
            onClick={() => {
              picker.current?.click()
            }}
          >
            {file === undefined ? 'Choose image…' : 'Choose another…'}
          </Button>
          <span className={styles.chosen()} id={`${id}-chosen`}>
            {file === undefined ? ACCEPTED_TYPES : file.name}
          </span>
        </div>
        <p className={styles.help()}>
          An animation may have at most {EMOJI_MAX_FRAMES} frames and {EMOJI_MAX_SECONDS} seconds.
          It plays briefly, then rests on its poster frame, which is all readers who ask for less
          motion see.
        </p>
      </div>
      {frames === undefined ? undefined : (
        <PosterFrame
          count={frames.count}
          value={poster}
          preview={posterPreview}
          onValueChange={(index) => {
            choosePoster(index, frames)
          }}
        />
      )}
      <Input
        label="Name"
        value={name}
        spellCheck={false}
        autoComplete="off"
        className="w-full"
        description="Written :name: in a document."
        {...(problem === undefined ? {} : { error: problem })}
        onChange={(event) => {
          setName(event.target.value.trim().toLowerCase())
        }}
      />
      {tooLarge ? (
        <Callout tone="danger" title="That image is too large">
          An emoji image may be at most 256 KB. Export a smaller one and choose that.
        </Callout>
      ) : undefined}
      {upload.error === null ? undefined : (
        <Callout tone="danger" title="That image could not be added">
          {upload.error.message}
        </Callout>
      )}
      <Button
        size="sm"
        variant="secondary"
        iconStart={<PlusIcon />}
        loading={upload.isPending}
        disabled={file === undefined || tooLarge || name === '' || problem !== undefined}
        onClick={() => {
          if (file !== undefined) void add(file)
        }}
      >
        Add emoji
      </Button>
    </div>
  )
}
