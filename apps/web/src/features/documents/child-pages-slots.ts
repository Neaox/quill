import { CHILD_PAGES_BLOCK, parseChildPagesSlotKey } from '@quill/markdown/child-pages-slot'
import type { ChildPagesQuery } from '@quill/markdown/child-pages-slot'
import { buttonClassName } from '@quill/ui'

/**
 * Fills the child pages slots of a mounted body (ADR-032, ADR-054).
 *
 * The body is cached for every reader (ADR-031), so a `::children` block
 * arrives as a slot holding a fallback line. This asks the server for each
 * slot's list, for this reader, and puts the answer where the fallback was;
 * the slot's title, and so its name, stay as they were. The answer is the
 * server's own template, built from escaped text, so the app and the public
 * site draw a list identically.
 *
 * While a list is on its way the slot says it is busy. A list that cannot be
 * loaded leaves the fallback in place and says why, rather than an empty
 * block. A page with no children, read by someone who can write here, offers
 * to create one.
 */

export interface ChildPagesSlotsOptions {
  load(
    query: ChildPagesQuery,
    signal: AbortSignal,
  ): Promise<{ readonly html: string; readonly count: number }>
  /** Offered in an empty list to someone who can write here; omitted, no action is shown. */
  readonly createChildPage?: (() => void) | undefined
}

export const CREATE_CHILD_PAGE = 'Create a child page'

export const CHILD_PAGES_UNAVAILABLE = 'The pages under this one could not be loaded.'

/** What a slot holds besides its title: the fallback, or a list put there before. */
const FILLED = ':scope > :not(.child-pages-title)'

function contentOf(html: string, owner: Document): readonly Node[] {
  const template = owner.createElement('template')
  template.innerHTML = html
  return [...template.content.childNodes]
}

function replaceContent(slot: Element, nodes: readonly Node[]): void {
  for (const old of slot.querySelectorAll(FILLED)) old.remove()
  slot.append(...nodes)
}

function createAction(owner: Document, create: () => void): HTMLElement {
  const paragraph = owner.createElement('p')
  paragraph.className = 'child-pages-action'
  const button = owner.createElement('button')
  button.type = 'button'
  button.className = buttonClassName({ variant: 'secondary', size: 'sm' })
  button.textContent = CREATE_CHILD_PAGE
  button.addEventListener('click', create)
  paragraph.append(button)
  return paragraph
}

export function fillChildPageSlots(root: ParentNode, options: ChildPagesSlotsOptions): () => void {
  const controller = new AbortController()
  const slots = [...root.querySelectorAll(`section[data-live-block="${CHILD_PAGES_BLOCK}"]`)]
  for (const slot of slots) {
    const query = parseChildPagesSlotKey(slot.getAttribute('data-live-key') ?? '')
    if (query === undefined) continue
    const owner = slot.ownerDocument
    slot.setAttribute('aria-busy', 'true')
    options
      .load(query, controller.signal)
      .then(({ html, count }) => {
        const action =
          count === 0 && options.createChildPage !== undefined
            ? [createAction(owner, options.createChildPage)]
            : []
        replaceContent(slot, [...contentOf(html, owner), ...action])
      })
      .catch(() => {
        if (controller.signal.aborted) return
        const note = owner.createElement('p')
        note.className = 'child-pages-fallback'
        note.textContent = CHILD_PAGES_UNAVAILABLE
        replaceContent(slot, [note])
      })
      .finally(() => {
        slot.removeAttribute('aria-busy')
      })
  }
  return () => {
    controller.abort()
  }
}
