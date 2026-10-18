import { Placeholder } from '@tiptap/extension-placeholder'
import type { Extensions } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

import { withLeafDirectiveViews } from '../blocks/leaf-directive-view.tsx'
import { withCodeBlockView } from '../code-block/code-block-view.ts'
import { DetailsEditing, withDetailsView } from '../details/details-extension.ts'
import { CodeGroupReveal, withCodeGroupView } from '../code-block/code-group-view.ts'
import { Autoformat } from './autoformat.ts'
import { withImageActions } from '../image/image-actions.ts'
import type { ImageAction } from '../image/image-actions.ts'
import { withFrontMatterView } from '../properties/front-matter-view.ts'
import { withLabels } from '../schema/dom.ts'
import { baseExtensions } from '../schema/editor-schema.ts'
import { emojiSuggestion } from '../emoji/emoji-suggestion.ts'
import { FindAndReplace } from '../find/find-extension.ts'
import { shortcutsHelp } from '../shortcuts/shortcuts-help.ts'
import { createSlashRecents, emojiRecentsKey } from '../slash/slash-recents.ts'
import type { SlashRecents } from '../slash/slash-recents.ts'
import { slashMenu } from '../slash/slash-extension.ts'
import type { SlashMenuOptions } from '../slash/slash-extension.ts'
import { withDirectiveViews } from '../template/directive-view.ts'
import { GuidanceDismissal } from '../template/dismissal.ts'
import { PlaceholderTyping } from '../template/placeholder-typing.ts'
import { RequiredSections } from '../template/required-markers.ts'
import { fileDrop } from './files.ts'
import type { FileDropOptions } from './files.ts'
import { CaretContext } from './caret-context.ts'
import { HoldStopsAtBlockEdge } from './hold-guard.ts'
import { KeyboardShortcuts } from './keymap.ts'
import { LinkDefaultDisplayExtension } from '../link/link-default-display.ts'
import { LinkEmbedsExtension } from '../link/link-embeds.ts'
import { LinkOfferExtension } from '../link/link-offer.ts'
import { MarkdownPaste } from './paste.ts'
import { withTableViews } from '../table/table-extension.ts'
import { TaskToggle, withTaskItemView } from '../task/task-item-view.ts'
import { FootnoteNumbers, withFootnoteView } from '../footnote/footnote-view.ts'
import { CalloutTitle } from '../callout/callout-title.ts'
import { WordSelection } from '../selection/word-selection.ts'
import { HeldSelectionExtension } from '../toolbar/held-selection.ts'
import { TableCopy } from '../table/table-copy.ts'
import { TablePaste } from '../table/table-paste.ts'
import { TablePresentation } from '../table/table-presentation.ts'
import type { EditorEmojiOptions } from './emoji.ts'
import { emojiShortcodes } from './emoji.ts'
import { unknownLabels } from './unknown-labels.ts'

/**
 * The whole extension list the editor runs.
 *
 * Everything below the node views is the Markdown package's published schema;
 * everything above it is behaviour. Nothing here declares a node or a mark, so
 * the assembled schema is still the one the converter targets.
 */

export interface EditorExtensionOptions {
  /** The hint shown in an empty document. */
  readonly placeholder?: string
  readonly slash?: SlashMenuOptions
  /**
   * Told about files dragged onto the document or pasted into it. Omitted, the
   * browser's own drop behaviour applies, which is what an editor with nowhere
   * to upload to should do.
   */
  readonly files?: FileDropOptions
  /**
   * The organisation's label names (ADR-037), drawn as the reader draws them;
   * a labelled directive named by none of them is warned about. Omitted until
   * they are known, so no label is called unknown before the theme has said.
   */
  readonly labels?: readonly string[]
  /**
   * The organisation's own emoji and each label's leading one (ADR-038).
   * GitHub's shortcodes are drawn without them; omitted, `:acme:` reads as
   * written until they are known.
   */
  readonly emoji?: EditorEmojiOptions
  /** Asked for when the writer presses Ctrl+/; omitted, the key does nothing. */
  readonly onShowShortcuts?: () => void
  /** What the emoji menu offers first: the emoji chosen last. Omitted, none are remembered. */
  readonly emojiRecents?: SlashRecents
  /**
   * Actions on images, from the extensions that own them (ADR-039): draw.io's
   * "Edit diagram" (ADR-043). Omitted, an image is drawn as before.
   */
  readonly imageActions?: readonly ImageAction[]
}

/** The hint on an empty line, which says how to insert a block without a menu to find first. */
export const EMPTY_LINE_HINT = 'Type / for blocks'

/**
 * What an empty block says: the document's own hint when the whole document
 * is empty, the slash hint on the empty line the caret is on, and a heading
 * its level, as Notion does. Shown only on the caret's line, so a page with
 * gaps in it is not covered in grey, and only on a top-level line: finding
 * the caret's line is then one lookup rather than a walk of the document,
 * which a keystroke in a long one cannot afford (quill-plan.md section 31).
 */
export function placeholderFor(
  emptyDocument: string,
): (props: { readonly editor: { readonly isEmpty: boolean }; readonly node: PMNode }) => string {
  return ({ editor, node }) => {
    if (editor.isEmpty) return emptyDocument
    if (node.type.name === 'heading') return `Heading ${String(node.attrs['level'])}`
    return node.type.name === 'paragraph' ? EMPTY_LINE_HINT : ''
  }
}

/** Remembers nothing beyond the page, for an editor not told where to keep what it remembers. */
const FORGETFUL = createSlashRecents(emojiRecentsKey(), null)

const NO_CUSTOM_EMOJI: EditorEmojiOptions = { custom: new Map(), labelEmoji: new Map() }

export function buildExtensions(options: EditorExtensionOptions = {}): Extensions {
  const views = withImageActions(
    withFrontMatterView(
      withDetailsView(
        withDirectiveViews(
          withCodeGroupView(
            withCodeBlockView(
              withFootnoteView(
                withTaskItemView(
                  withLeafDirectiveViews(
                    withTableViews(withLabels(baseExtensions, options.labels ?? [])),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    options.imageActions ?? [],
  )
  return [
    ...views,
    CodeGroupReveal,
    DetailsEditing,
    KeyboardShortcuts,
    HoldStopsAtBlockEdge,
    FindAndReplace,
    CaretContext,
    TaskToggle,
    FootnoteNumbers,
    Autoformat,
    // Before the Markdown paste handler: a pasted picture carries a file and
    // often an HTML fragment describing it, and the file is what was copied.
    ...(options.files === undefined ? [] : [fileDrop(options.files)]),
    // A pasted spreadsheet becomes a clean table, before anything else reads it.
    CalloutTitle,
    HeldSelectionExtension,
    WordSelection,
    TableCopy,
    TablePaste,
    TablePresentation,
    MarkdownPaste,
    LinkOfferExtension,
    LinkDefaultDisplayExtension,
    LinkEmbedsExtension,
    GuidanceDismissal,
    PlaceholderTyping,
    RequiredSections,
    ...(options.labels === undefined ? [] : [unknownLabels(options.labels)]),
    emojiShortcodes(options.emoji ?? NO_CUSTOM_EMOJI),
    Placeholder.configure({
      placeholder: placeholderFor(
        options.placeholder ?? 'Write something, or press / to insert a block',
      ),
    }),
    ...(options.onShowShortcuts === undefined ? [] : [shortcutsHelp(options.onShowShortcuts)]),
    ...(options.slash === undefined
      ? []
      : [
          slashMenu(options.slash),
          emojiSuggestion({
            store: options.slash.store,
            custom: (options.emoji ?? NO_CUSTOM_EMOJI).custom,
            recents: options.emojiRecents ?? FORGETFUL,
          }),
        ]),
  ]
}
