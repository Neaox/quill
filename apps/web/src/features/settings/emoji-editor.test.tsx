import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateTheme, instrument } from '@quill/theme'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import type { AnimationFrames } from '../../lib/media/animation-frames.ts'
import {
  EmojiEditor,
  emojiNameProblem,
  nameFromFile,
  type CustomEmojiList,
  type ServedEmoji,
} from './emoji-editor.tsx'

const HASH = '0123456789abcdef'.repeat(4)
const ACME = {
  name: 'acme',
  hash: HASH,
  mediaType: 'image/svg+xml',
  width: 64,
  height: 64,
} as const

const UPLOAD = 'POST /api/settings/organisation/emoji-images'

function Harness({
  initial,
  served = new Map(),
  readFrames,
}: {
  readonly initial?: CustomEmojiList | undefined
  readonly served?: ReadonlyMap<string, ServedEmoji>
  readonly readFrames?: (file: File) => Promise<AnimationFrames | undefined>
}) {
  const [emoji, setEmoji] = useState<CustomEmojiList | undefined>(initial)
  const generated = generateTheme(instrument)
  return (
    <>
      <EmojiEditor
        emoji={emoji}
        served={served}
        light={generated.light}
        dark={generated.dark}
        onEmojiChange={setEmoji}
        {...(readFrames === undefined ? {} : { readFrames })}
      />
      <output data-testid="emoji">{JSON.stringify(emoji ?? null)}</output>
    </>
  )
}

const saved = (): unknown => JSON.parse(screen.getByTestId('emoji').textContent ?? 'null')

function renderEditor(props: Parameters<typeof Harness>[0] = {}, routes: FakeRoutes = {}) {
  return render(<Harness {...props} />, { wrapper: createHookWrapper(routes) })
}

const svgFile = (name = 'Acme logo.svg', size = 120) =>
  new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(size, ' ')], name, {
    type: 'image/svg+xml',
  })

// jsdom has no object URLs; the form makes one per chosen file.
beforeEach(() => {
  let made = 0
  URL.createObjectURL = vi.fn<(object: Blob) => string>((object) => {
    made += 1
    return object instanceof File ? 'blob:preview' : `blob:frame-${String(made)}`
  })
  URL.revokeObjectURL = vi.fn<(url: string) => void>()
})

const partyGif = () => new File(['GIF89a'], 'party.gif', { type: 'image/gif' })

/** Four frames, each drawn as a PNG naming its index. */
function fourFrames() {
  const close = vi.fn<() => void>()
  const frames: AnimationFrames = {
    count: 4,
    frame: (index) => Promise.resolve(new Blob([`frame ${String(index)}`], { type: 'image/png' })),
    close,
  }
  return { frames, close, readFrames: () => Promise.resolve(frames) }
}

describe('EmojiEditor (ADR-038)', () => {
  it('previews a saved emoji at text size, in light and dark, and removes it', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor({
      initial: [ACME],
      served: new Map([['acme', { src: `/api/emoji/acme.${HASH.slice(0, 16)}.svg` }]]),
    })

    expect(screen.getByText(':acme:')).toBeInTheDocument()
    expect(screen.getByText('SVG · 64 × 64')).toBeInTheDocument()
    const preview = screen.getByRole('group', { name: 'Preview of :acme: at text size' })
    expect(within(preview).getByText('Light')).toBeInTheDocument()
    expect(within(preview).getByText('Dark')).toBeInTheDocument()
    expect(within(preview).getAllByRole('img', { name: ':acme:' })).toHaveLength(2)
    // Neutral words around it, so any organisation's emoji reads naturally.
    expect(within(preview).getAllByText(/Inline with text/u)).toHaveLength(2)
    await expectNoAccessibilityViolations(container)

    await user.click(screen.getByRole('button', { name: 'Remove the emoji :acme:' }))
    expect(saved()).toBeNull()
  })

  it('previews an animation moving and still, labelled, and offers the still under reduced motion', async () => {
    const STILL = 'fedcba9876543210'.repeat(4)
    const { container } = renderEditor({
      initial: [{ ...ACME, name: 'party', mediaType: 'image/gif', still: STILL }],
      served: new Map([
        [
          'party',
          {
            src: `/api/emoji/party.${HASH.slice(0, 16)}.gif`,
            still: `/api/emoji/party.${STILL.slice(0, 16)}.gif`,
          },
        ],
      ]),
    })

    expect(screen.getByText('GIF, animated · 64 × 64')).toBeInTheDocument()
    const moving = screen.getByRole('group', { name: 'Preview of :party: at text size' })
    const source = moving.querySelector('picture > source')
    expect(source).toHaveAttribute('media', '(prefers-reduced-motion: reduce)')
    expect(source).toHaveAttribute('srcset', `/api/emoji/party.${STILL.slice(0, 16)}.gif`)
    const still = screen.getByRole('group', {
      name: 'Preview of :party: still, for reduced motion',
    })
    expect(within(still).getAllByRole('img', { name: ':party:' })[0]).toHaveAttribute(
      'src',
      `/api/emoji/party.${STILL.slice(0, 16)}.gif`,
    )
    await expectNoAccessibilityViolations(container)
  })

  it('lists the image types it takes, plainly, and the limits an animation has', () => {
    renderEditor()
    expect(screen.getByText('PNG, JPEG, GIF, WebP, AVIF or SVG, up to 256 KB')).toBeInTheDocument()
    expect(screen.getByLabelText('Image')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml',
    )
    expect(screen.getByText(/at most 300 frames and 10 seconds/u)).toBeInTheDocument()
  })

  it('keeps the still the server cut from an animated upload', async () => {
    const user = userEvent.setup()
    const STILL = 'fedcba9876543210'.repeat(4)
    renderEditor(
      {},
      { [UPLOAD]: () => jsonResponse(201, { hash: HASH, mediaType: 'image/gif', still: STILL }) },
    )
    await user.upload(
      screen.getByLabelText('Image'),
      new File(['GIF89a'], 'party.gif', { type: 'image/gif' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))

    await vi.waitFor(() => {
      expect(saved()).toEqual([
        { name: 'party', hash: HASH, mediaType: 'image/gif', still: STILL, width: 64, height: 64 },
      ])
    })
  })

  describe('the poster frame (ADR-047)', () => {
    const POSTER = 'abcdefabcdefabcd'.repeat(4)
    const ORIGINAL = '9876543210fedcba'.repeat(4)
    const STILL = 'fedcba9876543210'.repeat(4)
    const ANIMATION = {
      hash: HASH,
      mediaType: 'image/gif',
      still: STILL,
      frames: 4,
      milliseconds: 400,
      plays: 3,
      original: ORIGINAL,
    }
    it('offers a scrubber over the frames, the first chosen, each previewed as it is reached', async () => {
      const user = userEvent.setup()
      const { readFrames } = fourFrames()
      const { container } = renderEditor({ readFrames })
      await user.upload(screen.getByLabelText('Image'), partyGif())

      const scrubber = await screen.findByRole('slider', { name: 'Poster frame' })
      expect(scrubber).toHaveAttribute('aria-valuetext', 'Frame 1 of 4')
      expect(await screen.findByRole('img', { name: 'Frame 1 of 4' })).toHaveAttribute(
        'src',
        expect.stringMatching(/^blob:frame-/u),
      )
      expect(screen.getByText(/rests on after playing/u)).toBeInTheDocument()

      // The native slider: arrows, Home and End are the browser's own.
      fireEvent.change(scrubber, { target: { value: '3' } })
      expect(scrubber).toHaveAttribute('aria-valuetext', 'Frame 3 of 4')
      expect(await screen.findByRole('img', { name: 'Frame 3 of 4' })).toBeInTheDocument()
      await expectNoAccessibilityViolations(container)
    })

    it('cuts the chosen frame as the still, and records which it is', async () => {
      const user = userEvent.setup()
      const { readFrames } = fourFrames()
      // The animation first, then the frame the browser cut as a PNG.
      const answers = [
        jsonResponse(201, ANIMATION),
        jsonResponse(201, { hash: POSTER, mediaType: 'image/png' }),
      ]
      renderEditor(
        { readFrames },
        { [UPLOAD]: () => answers.shift() ?? errorResponse(500, 'unexpected', 'A third upload') },
      )
      await user.upload(screen.getByLabelText('Image'), partyGif())
      fireEvent.change(await screen.findByRole('slider', { name: 'Poster frame' }), {
        target: { value: '3' },
      })
      await user.click(screen.getByRole('button', { name: 'Add emoji' }))

      await vi.waitFor(() => {
        expect(saved()).toEqual([
          {
            ...ANIMATION,
            name: 'party',
            still: POSTER,
            stillType: 'image/png',
            poster: 2,
            width: 64,
            height: 64,
          },
        ])
      })
      expect(answers).toEqual([])
      expect(screen.getByText('GIF, animated · 4 frames, 0.4 s · 64 × 64')).toBeInTheDocument()
      expect(screen.queryByRole('slider', { name: 'Poster frame' })).toBeNull()
    })

    it('keeps the still the server cut when the first frame is the poster', async () => {
      const user = userEvent.setup()
      const { readFrames, close } = fourFrames()
      renderEditor({ readFrames }, { [UPLOAD]: () => jsonResponse(201, ANIMATION) })
      await user.upload(screen.getByLabelText('Image'), partyGif())
      await screen.findByRole('slider', { name: 'Poster frame' })
      await user.click(screen.getByRole('button', { name: 'Add emoji' }))

      await vi.waitFor(() => {
        expect(saved()).toEqual([{ ...ANIMATION, name: 'party', width: 64, height: 64 }])
      })
      expect(close).toHaveBeenCalled()
    })

    it('offers no scrubber where the browser has no frames to give', async () => {
      const user = userEvent.setup()
      renderEditor({ readFrames: () => Promise.resolve(undefined) })
      await user.upload(screen.getByLabelText('Image'), partyGif())
      expect(screen.queryByRole('slider', { name: 'Poster frame' })).toBeNull()
    })

    it('lets go of the frames of a file chosen over', async () => {
      const user = userEvent.setup()
      const first = fourFrames()
      const second = fourFrames()
      const readers = [first.readFrames, second.readFrames]
      renderEditor({ readFrames: async () => (readers.shift() ?? second.readFrames)() })
      await user.upload(screen.getByLabelText('Image'), partyGif())
      await screen.findByRole('slider', { name: 'Poster frame' })
      await user.upload(screen.getByLabelText('Image'), partyGif())
      await vi.waitFor(() => {
        expect(first.close).toHaveBeenCalled()
      })
      expect(second.close).not.toHaveBeenCalled()
    })

    it('says an animated WebP plays as uploaded, its still waiting for the image pipeline', () => {
      renderEditor({
        initial: [{ ...ACME, name: 'spin', mediaType: 'image/webp', frames: 8, milliseconds: 800 }],
      })
      expect(screen.getByText('WebP, animated, plays as uploaded · 64 × 64')).toBeInTheDocument()
    })
  })

  it('shows no preview for an emoji whose image is not served yet under that hash', () => {
    renderEditor({
      initial: [ACME],
      served: new Map([['acme', { src: '/api/emoji/acme.ffffffffffffffff.svg' }]]),
    })
    expect(screen.queryByRole('group', { name: /Preview/u })).toBeNull()
  })

  it('uploads an image, names it from the file, and adds it', async () => {
    const user = userEvent.setup()
    renderEditor(
      {},
      { [UPLOAD]: () => jsonResponse(201, { hash: HASH, mediaType: 'image/svg+xml' }) },
    )

    const add = screen.getByRole('button', { name: 'Add emoji' })
    expect(add).toBeDisabled()
    await user.upload(screen.getByLabelText('Image'), svgFile())
    expect(screen.getByLabelText('Name')).toHaveValue('acme_logo')
    expect(screen.getByText('Acme logo.svg')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'acme_mark')
    await user.click(add)

    await vi.waitFor(() => {
      expect(saved()).toEqual([
        { name: 'acme_mark', hash: HASH, mediaType: 'image/svg+xml', width: 64, height: 64 },
      ])
    })
    // Shown from the file itself until it is saved and served.
    expect(screen.getAllByRole('img', { name: ':acme_mark:' })[0]).toHaveAttribute(
      'src',
      'blob:preview',
    )
  })

  it('opens the file picker from its button', async () => {
    const user = userEvent.setup()
    renderEditor()
    const picker = screen.getByLabelText('Image')
    const click = vi.spyOn(picker, 'click')
    await user.click(screen.getByRole('button', { name: 'Choose image…' }))
    expect(click).toHaveBeenCalled()
  })

  it('refuses a file over the cap before sending it, and says why the server refused one', async () => {
    const user = userEvent.setup()
    renderEditor(
      {},
      {
        [UPLOAD]: () =>
          errorResponse(422, 'file_type_mismatch', 'That file was sent as image/svg+xml'),
      },
    )
    await user.upload(screen.getByLabelText('Image'), svgFile('big.svg', 300 * 1024))
    expect(screen.getByText('That image is too large')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled()

    await user.upload(screen.getByLabelText('Image'), svgFile('logo.svg'))
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    expect(await screen.findByText('That image could not be added')).toBeInTheDocument()
  })

  it('says why a name cannot be used', async () => {
    const user = userEvent.setup()
    renderEditor({ initial: [ACME] })
    await user.type(screen.getByLabelText('Name'), 'acme')
    expect(screen.getByText('There is already an emoji called “acme”.')).toBeInTheDocument()
  })

  it('stops offering to add once the organisation holds the most it may', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      ...ACME,
      name: `e${String(index)}`,
    }))
    renderEditor({ initial: many })
    expect(screen.getByText('An organisation holds at most 100 emoji.')).toBeInTheDocument()
  })
})

describe('emoji names', () => {
  it('are checked in words a form can show', () => {
    expect(emojiNameProblem('acme_mark', [])).toBeUndefined()
    expect(emojiNameProblem('Acme', [])).toContain('lower-case')
  })

  it('start from the file’s name', () => {
    expect(nameFromFile('Acme logo.svg')).toBe('acme_logo')
    expect(nameFromFile('2024 Acme.png')).toBe('acme')
  })
})
