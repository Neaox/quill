/** Blocks of an unchanged stretch kept on each side of a change, so a change is read in place. */
const CONTEXT_BLOCKS = 1

/** The fewest blocks worth hiding: folding two paragraphs costs a click and saves nothing. */
const MIN_FOLDED = 4

export interface ComparisonSurface {
  /** Marks the change as the current one, brings it into view and puts focus on it. */
  readonly goTo: (changeId: string) => void
  /** Opens the fold that hides `target`, for the contents or a find that points into it. */
  readonly reveal: (target: Element | null) => void
  /** Puts the page back as it was handed over: no folds, no marks, nothing focusable added. */
  readonly dispose: () => void
}

interface Fold {
  readonly blocks: readonly HTMLElement[]
  readonly button: HTMLButtonElement
}

const isChange = (block: HTMLElement) =>
  block.hasAttribute('data-change') || block.querySelector('[data-change]') !== null

/** "Show 6 unchanged paragraphs", or "blocks" when the stretch is not all paragraphs. */
function foldLabel(blocks: readonly HTMLElement[]): string {
  const noun = blocks.every((block) => block.tagName === 'P') ? 'paragraphs' : 'blocks'
  return `Show ${String(blocks.length)} unchanged ${noun}`
}

/** The stretches of unchanged blocks, as [first, last] indices. */
function unchangedStretches(blocks: readonly HTMLElement[]): [number, number][] {
  const stretches: [number, number][] = []
  let start: number | undefined
  blocks.forEach((block, index) => {
    if (isChange(block)) {
      if (start !== undefined) stretches.push([start, index - 1])
      start = undefined
    } else {
      start ??= index
    }
  })
  if (start !== undefined) stretches.push([start, blocks.length - 1])
  return stretches
}

/**
 * Makes a rendered comparison readable at length (the comparison stylesheet draws the changes;
 * this decides what to show of the rest).
 *
 * A long unchanged stretch is folded behind a button that says what it holds, leaving one block
 * of context on each side of a change, because what a reader came for is what changed. Nothing is
 * folded when nothing changed. The changes are reached by `goTo`, which unfolds nothing (a change
 * is never folded) but marks and focuses it; `reveal` opens whichever fold hides a target the page
 * links into. `dispose` undoes all of it, so the same markup can be enhanced again.
 *
 * It works on the DOM it is given, because the comparison's body is the server's rendered HTML
 * mounted by `DocumentBody` rather than something React draws.
 */
export function enhanceComparison(root: HTMLElement): ComparisonSurface {
  const blocks = [...root.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  const added = new Set<HTMLElement>()
  const folds: Fold[] = []

  function unfold(fold: Fold, andFocus: boolean) {
    for (const block of fold.blocks) block.removeAttribute('hidden')
    fold.button.remove()
    folds.splice(folds.indexOf(fold), 1)
    const first = fold.blocks[0]
    if (andFocus && first !== undefined) {
      first.setAttribute('tabindex', '-1')
      added.add(first)
      first.focus()
    }
  }

  if (blocks.some(isChange)) {
    for (const [first, last] of unchangedStretches(blocks)) {
      const from = first === 0 ? first : first + CONTEXT_BLOCKS
      const to = last === blocks.length - 1 ? last : last - CONTEXT_BLOCKS
      const hidden = blocks.slice(from, to + 1)
      const lead = hidden[0]
      if (lead === undefined || hidden.length < MIN_FOLDED) continue

      const button = root.ownerDocument.createElement('button')
      button.type = 'button'
      button.className = 'comparison-fold'
      button.textContent = foldLabel(hidden)
      const fold: Fold = { blocks: hidden, button }
      button.addEventListener('click', () => {
        unfold(fold, true)
      })
      for (const block of hidden) block.setAttribute('hidden', '')
      lead.before(button)
      folds.push(fold)
    }
  }

  function reveal(target: Element | null) {
    if (target === null) return
    const fold = folds.find(({ blocks: hidden }) =>
      hidden.some((block) => block === target || block.contains(target)),
    )
    if (fold !== undefined) unfold(fold, false)
  }

  function goTo(changeId: string) {
    for (const current of root.querySelectorAll('[data-change-current]')) {
      current.removeAttribute('data-change-current')
    }
    const target = root.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(changeId)}"]`)
    if (target === null) return
    target.setAttribute('data-change-current', '')
    reveal(target)
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1')
      added.add(target)
    }
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'center' })
  }

  function dispose() {
    // Each unfold takes its fold out of the list, so the first is always the next one.
    for (let fold = folds[0]; fold !== undefined; fold = folds[0]) unfold(fold, false)
    for (const current of root.querySelectorAll('[data-change-current]')) {
      current.removeAttribute('data-change-current')
    }
    for (const block of added) block.removeAttribute('tabindex')
    added.clear()
  }

  return { goTo, reveal, dispose }
}
