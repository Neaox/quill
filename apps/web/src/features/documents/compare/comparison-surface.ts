/**
 * The reading surface of a comparison: long unchanged stretches folded away so the
 * changes are what a reader meets, and a way to go to one.
 *
 * A comparison is the whole document with its changes marked, and most of a long
 * document did not change. Each stretch of unchanged top-level blocks keeps one block of
 * context beside every change and folds the rest behind a button that says what it holds.
 * Folding is the `hidden` attribute, which also keeps the folded words from a screen
 * reader; the buttons and attributes it adds are undone by `dispose`.
 */

/** Fewer hidden blocks than this are not worth a button: showing them costs less than finding it. */
const MINIMUM_FOLDED = 3

const CHANGED = '[data-change], ins[data-diff], del[data-diff]'

export interface ComparisonSurface {
  /** Marks a change as the current one, focuses it and scrolls it into view. */
  readonly goTo: (changeId: string) => void
  /** Unfolds whatever hides the element, for a link (the contents) that points into the folded part. */
  readonly reveal: (target: Element | null) => void
  /** Puts the surface back as the server drew it. */
  readonly dispose: () => void
}

interface Fold {
  readonly button: HTMLButtonElement
  readonly blocks: readonly HTMLElement[]
}

function isChanged(block: HTMLElement): boolean {
  return block.matches(CHANGED) || block.querySelector(CHANGED) !== null
}

function describe(blocks: readonly HTMLElement[]): string {
  const noun = blocks.every((block) => block.tagName === 'P') ? 'paragraphs' : 'blocks'
  return `Show ${String(blocks.length)} unchanged ${noun}`
}

/** The stretches of unchanged blocks to hide: all but one block beside each change. */
function stretchesToFold(blocks: readonly HTMLElement[]): readonly (readonly HTMLElement[])[] {
  const changed = blocks.map(isChanged)
  if (!changed.includes(true)) return []

  const stretches: HTMLElement[][] = []
  let start = 0
  while (start < blocks.length) {
    if (changed[start] === true) {
      start += 1
      continue
    }
    let end = start
    while (end < blocks.length && changed[end] !== true) end += 1
    const from = start > 0 ? start + 1 : start
    const to = end < blocks.length ? end - 1 : end
    if (to - from >= MINIMUM_FOLDED) stretches.push(blocks.slice(from, to))
    start = end
  }
  return stretches
}

export function enhanceComparison(root: HTMLElement): ComparisonSurface {
  const folds = new Set<Fold>()
  const focusable = new Set<HTMLElement>()
  let current: Element | null = null

  function focusOn(element: HTMLElement): void {
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1')
      focusable.add(element)
    }
    element.focus()
  }

  function unfold(fold: Fold): void {
    for (const block of fold.blocks) block.removeAttribute('hidden')
    fold.button.remove()
    folds.delete(fold)
  }

  for (const blocks of stretchesToFold(
    [...root.children].filter((e) => e instanceof HTMLElement),
  )) {
    const first = blocks[0]
    if (first === undefined) continue
    const button = root.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = 'comparison-fold'
    button.textContent = describe(blocks)
    for (const block of blocks) block.setAttribute('hidden', '')
    first.before(button)

    const fold: Fold = { button, blocks }
    button.addEventListener('click', () => {
      unfold(fold)
      focusOn(first)
    })
    folds.add(fold)
  }

  return {
    goTo(changeId) {
      const target = [...root.querySelectorAll<HTMLElement>('[data-change-id]')].find(
        (candidate) => candidate.dataset['changeId'] === changeId,
      )
      if (target === undefined) return
      current?.removeAttribute('data-change-current')
      target.setAttribute('data-change-current', '')
      current = target
      focusOn(target)
      target.scrollIntoView({ block: 'center' })
    },
    reveal(target) {
      if (target === null) return
      for (const fold of Array.from(folds)) {
        if (fold.blocks.some((block) => block.contains(target))) unfold(fold)
      }
    },
    dispose() {
      for (const fold of Array.from(folds)) unfold(fold)
      for (const element of focusable) element.removeAttribute('tabindex')
      focusable.clear()
      current?.removeAttribute('data-change-current')
      current = null
    },
  }
}
