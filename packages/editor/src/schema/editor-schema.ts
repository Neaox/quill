import { getSchema } from '@tiptap/core'
import type { Extensions } from '@tiptap/core'
import { extensions as markdownExtensions } from '@quill/markdown'
import type { Schema } from '@tiptap/pm/model'

import { withDom } from './dom.ts'
import { withTables } from './tables.ts'

/**
 * The editor's extension list: the Markdown package's, given a DOM and table
 * editing. Nothing is added to the node set and nothing is taken away, so a
 * document produced here converts back through `proseMirrorToMdast` unchanged
 * (ADR-003: the schema is declared once, in `packages/markdown`).
 *
 * Behaviour — node views, keymaps, menus, autosave — is layered on top of this
 * list by the editor's own extensions, which add plugins and never nodes.
 */
export const baseExtensions: Extensions = withTables(withDom(markdownExtensions))

export const editorSchema: Schema = getSchema(baseExtensions)
