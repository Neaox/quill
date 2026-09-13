import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { useThemeVariants } from '../theme/theme-variants.tsx'

export const commentsPanelStyles = tv({
  slots: {
    root: '',
    heading: 'meta pb-2',
    list: 'flex flex-col gap-3',
    link: [
      'flex flex-col gap-0.5 rounded-sm text-xs leading-normal text-muted',
      'transition-colors ease-standard hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    anchor: 'meta-value',
    author: 'font-medium text-foreground',
  },
})

export interface DocumentComment {
  readonly id: string
  readonly author: string
  /** Where in the document it is anchored, as a reader sees it: `L18`. */
  readonly anchor: string
  readonly body: string
  /** `YYYY-MM-DD`, for a `<time datetime>`. */
  readonly at: string
  readonly href: string
}

export interface CommentsPanelProps {
  readonly label?: string | undefined
  readonly comments: readonly DocumentComment[]
  /**
   * `panel` is the column below; `sidenotes` is Press's margin notes, which
   * are **not built yet** — the panel renders instead and marks itself
   * `data-comments="sidenotes"`. See `TODO(ADR-028)` in `comments-panel.test.tsx`.
   */
  readonly variant?: ThemeVariants['comments'] | undefined
  readonly className?: string | undefined
}

/**
 * The comments on a document.
 *
 * A complementary region with an ordered list of anchored notes: each one
 * names its author, says where in the document it is attached, and is a link
 * to that place. The count is in the region's name rather than in a badge, so
 * a screen reader hears it on the way in.
 */
export function CommentsPanel({
  label = 'Comments',
  comments,
  variant,
  className,
}: CommentsPanelProps) {
  const variants = useThemeVariants()
  const presentation = variant ?? variants.comments
  const styles = commentsPanelStyles()

  return (
    <section
      aria-label={`${label}, ${comments.length}`}
      data-comments={presentation}
      className={styles.root({ className })}
    >
      <p className={styles.heading()} aria-hidden="true">
        {label} {comments.length}
      </p>
      <ol className={styles.list()}>
        {comments.map((comment) => (
          <li key={comment.id}>
            <a href={comment.href} className={styles.link()}>
              <span className={styles.anchor()}>
                {comment.anchor} <time dateTime={comment.at}>{comment.at}</time>
              </span>
              <span>
                <span className={styles.author()}>{comment.author}</span> {comment.body}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
