import { distanceToChange } from './source-hunks.ts'

/**
 * The parts of a comparison's page that live in the mounted body rather than
 * in React: folding unchanged stretches, and moving between changes.
 *
 * The body is the server's HTML, mounted by `DocumentBody` straight onto the
 * reading grid (ADR-027), so a stretch cannot be wrapped in anything without
 * pulling its blocks off the grid. Instead each folded block is `hidden` where
 * it stands, and a native `<button>` is put in front of the stretch to unfold
 * it — keyboard-operable and announced with no ARIA of its own. A long
 * document with a handful of changes therefore lays out a handful of blocks.
 */

export interface ComparisonSurface {
  /** Unfolds, marks as current, scrolls to and focuses the change with this id. */
  readonly goTo: (id: string) => void
  /** Unfolds whatever stretch holds this element, so it can be reached. */
  readonly reveal: (element: Element | null) => void
  /** Puts the body back as it was mounted. */
  readonly dispose: () => void
}

export interface FoldOptions {
  /** Unchanged blocks kept on each side of a change, for context. */
  readonly context?: number
  /** A stretch shorter than this is shown rather than folded. */
  readonly minimum?: number
}

const CHANGE = '[data-change]'
const CURRENT = 'data-change-current'

interface Fold {
  readonly button: HTMLButtonElement
  readonly blocks: readonly HTMLElement[]
}

function noun(blocks: readonly Element[]): string {
  const paragraphs = blocks.every((block) => block.tagName === 'P')
  if (blocks.length === 1) return paragraphs ? 'paragraph' : 'block'
  return paragraphs ? 'paragraphs' : 'blocks'
}

export function enhanceComparison(
  article: HTMLElement,
  { context = 1, minimum = 4 }: FoldOptions = {},
): ComparisonSurface {
  const doc = article.ownerDocument
  const blocks = [...article.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  const changed = blocks.map((block) => block.matches(CHANGE))
  const folds: Fold[] = []
  const focusable: HTMLElement[] = []

  for (const target of article.querySelectorAll<HTMLElement>('[data-change-id]')) {
    if (target.hasAttribute('tabindex')) continue
    target.tabIndex = -1
    focusable.push(target)
  }

  if (changed.some(Boolean)) {
    const distance = distanceToChange(changed)
    const near = (index: number) => (distance[index] ?? Infinity) <= context
    let run: HTMLElement[] = []
    const close = () => {
      if (run.length >= minimum) folds.push(fold(run))
      run = []
    }
    for (const [index, block] of blocks.entries()) {
      if (changed[index] === true || near(index)) close()
      else run.push(block)
    }
    close()
  }

  function fold(stretch: readonly HTMLElement[]): Fold {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'comparison-fold'
    button.textContent = `Show ${stretch.length} unchanged ${noun(stretch)}`
    for (const block of stretch) block.hidden = true
    stretch[0]?.before(button)
    const entry: Fold = { button, blocks: stretch }
    button.addEventListener('click', () => {
      const first = unfold(entry)
      if (first === undefined) return
      if (!first.hasAttribute('tabindex')) {
        first.tabIndex = -1
        focusable.push(first)
      }
      first.focus()
    })
    return entry
  }

  function unfold(entry: Fold): HTMLElement | undefined {
    const index = folds.indexOf(entry)
    if (index === -1) return undefined
    folds.splice(index, 1)
    for (const block of entry.blocks) block.hidden = false
    entry.button.remove()
    return entry.blocks[0]
  }

  function reveal(element: Element | null): void {
    if (element === null) return
    const holder = folds.find((entry) =>
      entry.blocks.some((block) => block === element || block.contains(element)),
    )
    if (holder !== undefined) unfold(holder)
  }

  return {
    reveal,
    goTo(id) {
      const target = article.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(id)}"]`)
      if (target === null) return
      reveal(target)
      for (const current of article.querySelectorAll(`[${CURRENT}]`)) {
        current.removeAttribute(CURRENT)
      }
      target.setAttribute(CURRENT, '')
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.focus({ preventScroll: true })
    },
    dispose() {
      for (const entry of folds.toReversed()) unfold(entry)
      for (const element of focusable) element.removeAttribute('tabindex')
      for (const current of article.querySelectorAll(`[${CURRENT}]`)) {
        current.removeAttribute(CURRENT)
      }
    },
  }
}
