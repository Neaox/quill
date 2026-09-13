import { Placeholder } from '@tiptap/extension-placeholder'
import type { Extensions } from '@tiptap/core'

import { withCodeBlockView } from '../code-block/code-block-view.ts'
import { withFrontMatterView } from '../properties/front-matter-view.ts'
import { baseExtensions } from '../schema/editor-schema.ts'
import { slashMenu } from '../slash/slash-extension.ts'
import type { SlashMenuOptions } from '../slash/slash-extension.ts'
import { withDirectiveViews } from '../template/directive-view.ts'
import { GuidanceDismissal } from '../template/dismissal.ts'
import { PlaceholderTyping } from '../template/placeholder-typing.ts'
import { RequiredSections } from '../template/required-markers.ts'
import { KeyboardShortcuts } from './keymap.ts'
import { MarkdownPaste } from './paste.ts'

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
}

export function buildExtensions(options: EditorExtensionOptions = {}): Extensions {
  const views = withFrontMatterView(withDirectiveViews(withCodeBlockView(baseExtensions)))
  return [
    ...views,
    KeyboardShortcuts,
    MarkdownPaste,
    GuidanceDismissal,
    PlaceholderTyping,
    RequiredSections,
    Placeholder.configure({
      placeholder: options.placeholder ?? 'Write something, or press / to insert a block',
    }),
    ...(options.slash === undefined ? [] : [slashMenu(options.slash)]),
  ]
}
