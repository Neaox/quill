import { useId } from 'react'

import { tv } from '@quill/ui'

import { rangeFieldStyles } from './range-field.tsx'

const posterStyles = tv({
  slots: {
    root: 'flex w-full items-center gap-3 rounded-md border border-border bg-surface-raised p-3',
    // A checkerboard, so a transparent frame reads as transparent and not as blank.
    frame: [
      'grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-border',
      'bg-[repeating-conic-gradient(var(--color-border)_0_25%,transparent_0_50%)] bg-[length:12px_12px]',
    ],
    image: 'size-full object-contain',
    body: 'flex min-w-0 grow flex-col gap-1',
  },
})

export interface PosterFrameProps {
  /** How many frames the animation has. */
  readonly count: number
  /** The chosen frame, counted from nought. */
  readonly value: number
  readonly onValueChange: (value: number) => void
  /** The chosen frame drawn, once it has been; an object URL. */
  readonly preview: string | undefined
}

/**
 * The poster-frame choice in an animated emoji's upload preview (ADR-047):
 * the frame it rests on after playing briefly, which is also the still a
 * reader who asks for less motion sees. The first frame unless another is
 * chosen, for an animation that opens on a blank or a fade.
 *
 * A native `input[type=range]` scrubs the frames, so arrows, Page Up and
 * Down, Home and End and a pointer drag all work as the platform makes them,
 * and the frame is announced in words ("Frame 3 of 12") rather than as a bare
 * number. The frame itself is drawn beside it as it is reached.
 */
export function PosterFrame({ count, value, onValueChange, preview }: PosterFrameProps) {
  const id = useId()
  const styles = posterStyles()
  const field = rangeFieldStyles()
  const position = `Frame ${String(value + 1)} of ${String(count)}`

  return (
    <div className={styles.root()}>
      <div className={styles.frame()}>
        {preview === undefined ? undefined : (
          <img className={styles.image()} src={preview} alt={position} />
        )}
      </div>
      <div className={styles.body()}>
        <div className={field.header()}>
          <label htmlFor={id} className={field.label()}>
            Poster frame
          </label>
          <output htmlFor={id} className={field.value()}>
            {position}
          </output>
        </div>
        <input
          type="range"
          id={id}
          min={1}
          max={count}
          step={1}
          value={value + 1}
          aria-valuetext={position}
          aria-describedby={`${id}-description`}
          className={field.control()}
          onChange={(event) => {
            onValueChange(Number(event.target.value) - 1)
          }}
        />
        <p id={`${id}-description`} className={field.description()}>
          The still it rests on after playing, and what readers who ask for less motion see.
        </p>
      </div>
    </div>
  )
}
