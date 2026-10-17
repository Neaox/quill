import { CodeIcon, CopyIcon } from '@quill/ui'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

import type { ContextMenuContribution, MenuPlace } from '../context-menu/context-menu-registry.ts'

/**
 * The code block's part of the context menu: its language, copying its code,
 * and wrapping long lines.
 *
 * Wrapping is how this person reads code while they write, not something the
 * document says, so it is kept in this browser and applies to every code
 * block in the editor, as a code editor's own "word wrap" does.
 */

export const CODE_WRAP_KEY = 'editor.code.wrap'

function codeBlockAt(
  place: MenuPlace,
): { readonly node: PMNode; readonly pos: number } | undefined {
  const $pos = place.state.doc.resolve(place.pos)
  const after = $pos.nodeAfter
  if (after?.type.name === 'codeBlock') return { node: after, pos: place.pos }
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'codeBlock') return { node, pos: $pos.before(depth) }
  }
  return undefined
}

/** The element the wrapping preference is set on: the editor around the document. */
function wrapHost(view: EditorView): HTMLElement {
  return view.dom.closest<HTMLElement>('.document-editor') ?? view.dom
}

export function isWrapping(view: EditorView): boolean {
  return wrapHost(view).dataset['codeWrap'] === 'true'
}

/** Turns wrapping on or off, remembering the choice in this browser. */
export function setWrapping(view: EditorView, wrap: boolean): void {
  wrapHost(view).dataset['codeWrap'] = String(wrap)
  try {
    localStorage.setItem(CODE_WRAP_KEY, String(wrap))
  } catch {
    // Storage refused (a private window): it lasts for this page instead.
  }
}

/** Puts the remembered choice back on an editor that has just opened. */
export function restoreWrapping(view: EditorView): void {
  let remembered: string | null
  try {
    remembered = localStorage.getItem(CODE_WRAP_KEY)
  } catch {
    remembered = null
  }
  wrapHost(view).dataset['codeWrap'] = String(remembered === 'true')
}

/** Moves focus to a code block's language field, the one combobox its node view draws (`language-picker.tsx`). */
export function focusLanguage(block: Node | null): void {
  if (!(block instanceof Element)) return
  block.querySelector<HTMLElement>('input[role="combobox"]')?.focus()
}

export const codeBlockMenu: ContextMenuContribution = {
  id: 'code-block',
  order: 40,
  label: 'Code block',
  entries: (place) => {
    const block = codeBlockAt(place)
    if (block === undefined) return []
    const { view, environment } = place
    const wrapping = isWrapping(view)
    return [
      {
        kind: 'action',
        id: 'code-language',
        label: 'Change language…',
        icon: CodeIcon,
        run: () => {
          focusLanguage(view.nodeDOM(block.pos))
        },
      },
      {
        kind: 'action',
        id: 'copy-code',
        label: 'Copy code',
        icon: CopyIcon,
        disabledReason:
          environment.copyText === undefined ? 'The clipboard is not available here' : undefined,
        run: () => {
          void environment.copyText?.(block.node.textContent)
        },
      },
      {
        kind: 'action',
        id: 'wrap-code',
        label: wrapping ? 'Stop wrapping long lines' : 'Wrap long lines',
        run: () => {
          setWrapping(view, !wrapping)
        },
      },
    ]
  },
}
