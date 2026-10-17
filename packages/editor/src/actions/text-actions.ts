import { clearFormatting, INLINE_MARKS, isMarkActive, toggleInlineMark } from '../format/marks.ts'
import type { InlineMark } from '../format/marks.ts'
import { TEXT_STYLES, toggleTextStyle } from '../format/text-styles.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'

/**
 * The text formatting actions: what a stretch of text is made of, and what kind
 * of block it sits in. Both come straight from their registries, so a mark or a
 * style added there appears in the toolbar and the context menu without an edit
 * here.
 */

/** Each mark with its action, for a surface that draws every mark its own way. */
export const MARK_ACTIONS: readonly { readonly mark: InlineMark; readonly action: EditorAction }[] =
  INLINE_MARKS.map((mark) => ({
    mark,
    action: {
      id: mark.name,
      label: mark.label,
      keys: mark.key,
      kind: 'check',
      command: toggleInlineMark(mark.name),
      isChecked: (state) => isMarkActive(state, mark.name),
    },
  }))

export const MARK_GROUP: ActionGroup = {
  id: 'marks',
  label: 'Format',
  actions: MARK_ACTIONS.map(({ action }) => action),
}

/** The blocks that have a button of their own, as lists and quotes do in every editor. */
const SWITCH_STYLES = ['bullet-list', 'ordered-list', 'task-list', 'blockquote'] as const

/**
 * Each of those as a switch: pressed to make the block, pressed again to be rid of it,
 * and shown pressed while the caret is in one. The same styles are in the style menu,
 * which is where a heading or a code block is chosen; these are the ones that are
 * turned on and off.
 */
export const BLOCK_SWITCHES: readonly EditorAction[] = SWITCH_STYLES.flatMap((id) => {
  const style = TEXT_STYLES.find((candidate) => candidate.id === id)
  /* v8 ignore next -- SWITCH_STYLES names styles TEXT_STYLES defines; the check only narrows the type. */
  if (style === undefined) return []
  return [
    {
      id: `switch-${style.id}`,
      label: style.label,
      ...(style.key === undefined ? {} : { keys: style.key }),
      kind: 'check' as const,
      command: toggleTextStyle(style),
      isChecked: style.isActive,
    },
  ]
})

export const CLEAR_FORMATTING: EditorAction = {
  id: 'clear-formatting',
  label: 'Clear formatting',
  description: 'Take off bold, italic, strikethrough and code',
  keys: 'Mod-\\',
  command: clearFormatting,
}

export const CLEAR_FORMATTING_GROUP: ActionGroup = {
  id: 'clear-formatting',
  label: 'Format',
  actions: [CLEAR_FORMATTING],
}

export const STYLE_GROUP: ActionGroup = {
  id: 'styles',
  label: 'Turn into',
  actions: TEXT_STYLES.map((style) => ({
    id: style.id,
    label: style.label,
    description: style.description,
    ...(style.key === undefined ? {} : { keys: style.key }),
    kind: 'radio',
    command: style.command,
    isChecked: style.isActive,
  })),
}
