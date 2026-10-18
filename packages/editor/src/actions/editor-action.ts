import type { Command, EditorState } from '@tiptap/pm/state'

/**
 * Something the author can do to the document, described once.
 *
 * The formatting toolbar, its drop-down menus, and the context menu all offer
 * the same actions in different arrangements, so an action is data — a label, a
 * key binding, a command — and every surface is a rendering of a list of them.
 * Adding an action means adding it here; no menu has to be told.
 *
 * Whether an action is available is not stored: a ProseMirror command answers
 * "would this do anything here?" when it is run without a dispatch, so the
 * command is the single source of truth for both doing and being enabled.
 */

/** How an action is presented: a plain item, one of a set of choices, or an on/off switch. */
export type ActionKind = 'item' | 'radio' | 'check'

/** A colour that means something about the action, for a swatch beside its label. */
export type ActionTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface EditorAction {
  readonly id: string
  readonly label: string
  /** A sentence of what it does, for a menu that has room for one. */
  readonly description?: string
  /** In ProseMirror's key syntax, shown beside the label when the keyboard map binds one. */
  readonly keys?: string
  readonly kind?: ActionKind
  readonly tone?: ActionTone
  /** Removes something, so it is set apart and read as dangerous. */
  readonly destructive?: boolean
  readonly command: Command
  /**
   * Why the action is not available here, when it is not: shown on the disabled control, because
   * a control that is greyed out with no reason reads as broken.
   */
  whyUnavailable?(state: EditorState): string | undefined
  /** For `radio` and `check` actions: whether the choice is the current one. */
  isChecked?(state: EditorState): boolean
}

export interface ActionGroup {
  readonly id: string
  readonly label: string
  readonly actions: readonly EditorAction[]
}

export interface ActionState {
  readonly enabled: boolean
  readonly checked: boolean
}

export function actionState(action: EditorAction, state: EditorState): ActionState {
  const checked = action.isChecked?.(state) ?? false
  // The choice already in force is not "unavailable" because choosing it again
  // would change nothing: a menu that greyed it out would read as broken.
  return { enabled: checked || action.command(state), checked }
}

/** The groups with at least one action that can be used right now. */
export function availableGroups(
  groups: readonly ActionGroup[],
  state: EditorState,
): readonly ActionGroup[] {
  return groups.filter((group) => group.actions.some((action) => action.command(state)))
}
