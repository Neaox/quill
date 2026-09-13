import { tv } from '../lib/class-names.ts'

export const presentRailStyles = tv({
  slots: {
    root: 'fixed end-6 top-1/2 z-40 -translate-y-1/2',
    list: 'flex flex-col items-center gap-3.5',
    /*
     * The dot is the button's whole appearance, so the hit area is the
     * button and the mark inside it is drawn by `::before` in `present.css`.
     * Current is `aria-current`, which is the same fact the rail announces.
     */
    step: [
      'present-rail-step flex size-6 items-center justify-center rounded-full',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
})

export interface PresentRailItem {
  readonly id: string
  readonly title: string
}

export interface PresentRailProps {
  readonly items: readonly PresentRailItem[]
  /** Which item is being presented, counted from zero. */
  readonly currentIndex: number
  readonly onSelect: (index: number) => void
  readonly label?: string
  readonly className?: string | undefined
}

/**
 * The section rail: one mark per section down the edge of the screen, the
 * current one enlarged (the Present artboard).
 *
 * It is a `nav` of real buttons rather than a decorative strip, so the same
 * marks a room reads as "seven sections, we are on the second" are how a
 * keyboard or a pointer jumps to one. Each button is named for the section it
 * goes to, because a dot has no text of its own.
 */
export function PresentRail({
  items,
  currentIndex,
  onSelect,
  label = 'Sections',
  className,
}: PresentRailProps) {
  const styles = presentRailStyles()

  return (
    <nav aria-label={label} className={styles.root({ className })}>
      <ol className={styles.list()}>
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={index === currentIndex ? 'true' : undefined}
              aria-label={`Section ${index + 1}: ${item.title}`}
              onClick={() => onSelect(index)}
              className={styles.step()}
            />
          </li>
        ))}
      </ol>
    </nav>
  )
}
