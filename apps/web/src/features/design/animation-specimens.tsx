import { tv } from '@quill/ui'

import spinner from './spinner.gif'
import spinnerStill from './spinner-still.gif'
import type { TableSpecimen } from './table-specimens.gen.ts'
import { TableSpecimenFrame } from './table-specimens.tsx'

/**
 * An animated emoji (ADR-038, ADR-047), as a reader meets one: it plays
 * when it comes into view, for at most five seconds or three loops, then
 * rests on its still; hovering, focusing or tapping it plays it again; and a
 * reader who asks for less motion only ever sees the still.
 *
 * The spinner is self-made, not anybody's artwork: eight frames of 32 × 32
 * drawn by `tools/design-assets/spinner.py`, with its loop count bounded to three
 * plays as the server bounds an upload, and its first frame as its still.
 * The HTML is the renderer's own, with the fixture's addresses in place of
 * the server's: `animation-specimens.test.tsx` renders the Markdown again and
 * fails if the two have drifted.
 */
export const SPINNER = {
  src: spinner,
  still: spinnerStill,
  frames: 8,
  milliseconds: 960,
} as const

export const ANIMATION_SPECIMEN: TableSpecimen = {
  id: 'animated-emoji',
  label: 'Animated emoji',
  note: 'plays briefly when seen, again on hover, focus or a tap, and rests on its still',
  markdown: 'Deploying :spinner: now. Hover the spinner, or tap it, to play it again.',
  html: `<article><p>Deploying <picture class="emoji" data-frames="8" data-loop-ms="960"><source srcset="${spinnerStill}" media="(prefers-reduced-motion: reduce)"><img class="emoji" src="${spinner}" alt=":spinner:" title=":spinner:" width="20" height="20"></picture> now. Hover the spinner, or tap it, to play it again.</p></article>`,
}

const stillStyles = tv({
  slots: {
    root: 'flex items-center gap-3 rounded-md border border-border bg-surface-raised p-3',
    image: 'size-8 shrink-0',
    caption: 'text-xs leading-normal text-muted',
  },
})

export function AnimationSpecimens() {
  const styles = stillStyles()
  return (
    <div className="flex flex-col gap-6">
      <TableSpecimenFrame specimen={ANIMATION_SPECIMEN} />
      <figure className={styles.root()}>
        <img
          className={styles.image()}
          src={SPINNER.still}
          alt="The spinner’s still"
          width={32}
          height={32}
        />
        <figcaption className={styles.caption()}>
          Its still: the first frame unless the uploader chose another, and never the last. It is
          what the emoji rests on, and all a reader who asks for less motion sees. An animated WebP
          or AVIF has no still yet and plays as uploaded until the image pipeline makes one.
        </figcaption>
      </figure>
    </div>
  )
}
