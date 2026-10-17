import { Placeholder } from '@tiptap/extension-placeholder'
import type { Extensions } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

import { withCalloutViews } from '../callout/callout-view.ts'
import type { CalloutViewOptions } from '../callout/callout-view.ts'
import { withCodeBlockView } from '../code-block/code-block-view.ts'
import { contextMenuTrigger } from '../context-menu/context-menu-trigger.ts'
import { menusKeymap } from '../context-menu/menus-keymap.ts'
import type { MenusKeymapOptions } from '../context-menu/menus-keymap.ts'
import { DetailsEditing, withDetailsView } from '../details/details-extension.ts'
import { CodeGroupReveal, withCodeGroupView } from '../code-block/code-group-view.ts'
import { Autoformat } from './autoformat.ts'
import { withImageActions } from '../image/image-actions.ts'
import type { ImageAction } from '../image/image-actions.ts'
import { NavigationBlocks, withNavigationViews } from '../navigation/navigation-extension.ts'
import type { NavigationViewOptions } from '../navigation/navigation-view.ts'
import { withFrontMatterView } from '../properties/front-matter-view.ts'
import { withLabels } from '../schema/dom.ts'
import { baseExtensions } from '../schema/editor-schema.ts'
import { slashMenu } from '../slash/slash-extension.ts'
import type { SlashMenuOptions } from '../slash/slash-extension.ts'
import { withDirectiveViews } from '../template/directive-view.ts'
import { GuidanceDismissal } from '../template/dismissal.ts'
import { PlaceholderTyping } from '../template/placeholder-typing.ts'
import { RequiredSections } from '../template/required-markers.ts'
import { fileDrop } from './files.ts'
import type { FileDropOptions } from './files.ts'
import { KeyboardShortcuts } from './keymap.ts'
import { MarkdownPaste } from './paste.ts'
import { withTableViews } from '../table/table-extension.ts'
import { TaskToggle, withTaskItemView } from '../task/task-item-view.ts'
import { FootnoteNumbers, withFootnoteView } from '../footnote/footnote-view.ts'
import { TableDecorations } from '../table/table-decorations.ts'
import { TablePaste } from '../table/table-paste.ts'
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
  /**
   * Actions on images, from the extensions that own them (ADR-039): draw.io's
   * "Edit diagram" (ADR-043). Omitted, an image is drawn as before.
   */
  readonly imageActions?: readonly ImageAction[]
  /** What a callout's type button opens (`callout/callout-view.ts`). */
  readonly callouts?: CalloutViewOptions
  /**
   * The writing surface's menus: the context menu and the keys that reach the
   * link popover and the selection toolbar. Omitted, for a read-only editor.
   */
  readonly menus?: MenusKeymapOptions
  /**
   * What a child pages block previews (ADR-054): the application's list of
   * this page's children. Omitted, the block says in words what it will list.
   */
  readonly navigation?: NavigationViewOptions
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

const NO_CUSTOM_EMOJI: EditorEmojiOptions = { custom: new Map(), labelEmoji: new Map() }

export function buildExtensions(options: EditorExtensionOptions = {}): Extensions {
  const views = withImageActions(
    withFrontMatterView(
      withDetailsView(
        // Alerts and `:::callout` are drawn as the reader draws them; every
        // other directive keeps its own view.
        withCalloutViews(
          withDirectiveViews(
            withCodeGroupView(
              withCodeBlockView(
                withFootnoteView(
                  withTaskItemView(
                    withNavigationViews(
                      withTableViews(withLabels(baseExtensions, options.labels ?? [])),
                      options.navigation,
                    ),
                  ),
                ),
              ),
            ),
          ),
          options.callouts,
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
    TaskToggle,
    FootnoteNumbers,
    // The headings a table of contents lists, and the block selected whole (ADR-054).
    NavigationBlocks,
    Autoformat,
    // Before the Markdown paste handler: a pasted picture carries a file and
    // often an HTML fragment describing it, and the file is what was copied.
    ...(options.files === undefined ? [] : [fileDrop(options.files)]),
    // A pasted spreadsheet becomes a clean table, before anything else reads it.
    TablePaste,
    // A table's header, footer, row headers and columns, as the reader draws them.
    TableDecorations,
    MarkdownPaste,
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
    ...(options.slash === undefined ? [] : [slashMenu(options.slash)]),
    // The context menu, the link popover's Ctrl+K and the toolbar's Alt+F10.
    ...(options.menus === undefined
      ? []
      : [contextMenuTrigger({ store: options.menus.store }), menusKeymap(options.menus)]),
  ]
}
