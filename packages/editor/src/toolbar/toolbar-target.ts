import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

import { calloutAt } from '../callout/callouts.ts'
import type { CalloutContext } from '../callout/callouts.ts'
import type { LinkDisplay } from '@quill/markdown'

import { linkTargetAt } from '../link/link-display.ts'
import type { LinkTarget } from '../link/link-display.ts'
import { tableContext, tableScope } from '../table/table-context.ts'
import type { TableScope } from '../table/table-context.ts'

/**
 * What the floating toolbar is about right now.
 *
 * The toolbar is one surface that shows the tools for the innermost thing the
 * author is pointing at, so choosing which is a pure function of the editor
 * state and nothing in the UI re-derives it. "Innermost" is the rule that settles
 * overlaps: selected text is the most specific thing there is, then a link the
 * caret is resting in, then the table the caret is in (ADR-040), then the callout
 * around everything.
 */

export type ToolbarTarget =
  | { readonly kind: 'text'; readonly from: number; readonly to: number }
  | {
      readonly kind: 'link'
      readonly from: number
      readonly to: number
      readonly href: string
      /** Written as an ordinary link, an inline `:link` or a `::link` card. */
      readonly form: LinkTarget['form']
      readonly display: LinkDisplay
    }
  | { readonly kind: 'table'; readonly scope: TableScope; readonly tablePos: number }
  | { readonly kind: 'callout'; readonly callout: CalloutContext }

/** Text the toolbar can format: a range of a textblock that is not code. */
function formattableRange(state: EditorState): { from: number; to: number } | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || selection.empty) return null
  return selection.$from.parent.type.spec.code === true
    ? null
    : { from: selection.from, to: selection.to }
}

export function toolbarTarget(state: EditorState): ToolbarTarget | null {
  const range = formattableRange(state)
  if (range !== null) return { kind: 'text', ...range }

  const link = linkTargetAt(state)
  if (link !== null) {
    const { from, to, href, form, display } = link
    return { kind: 'link', from, to, href, form, display }
  }

  const table = tableContext(state)
  if (table !== undefined) {
    return { kind: 'table', scope: tableScope(table, state.selection), tablePos: table.tablePos }
  }

  const callout = calloutAt(state)
  return callout === null ? null : { kind: 'callout', callout }
}

/** Two targets with the same key are the same toolbar, so it need not be redrawn. */
export function targetKey(target: ToolbarTarget | null): string {
  if (target === null) return 'none'
  switch (target.kind) {
    case 'text':
    case 'link':
      return `${target.kind}:${String(target.from)}-${String(target.to)}`
    case 'table':
      return `table:${String(target.tablePos)}:${target.scope}`
    case 'callout':
      return `callout:${String(target.callout.pos)}`
  }
}
