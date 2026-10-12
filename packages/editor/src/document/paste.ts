import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { tv } from 'tailwind-variants'

import { astFragment, insertMarkdown, replaceSelectionWithFragment, setLink } from './commands.ts'
import { chooseFiles } from './files.ts'
import { pageMarkdownParser } from './markdown-parser.ts'
import type { ParseMarkdown } from './markdown-parser.ts'

/**
 * What the editor does with the clipboard.
 *
 * Two behaviours writers expect and one rule that keeps them out of the way:
 * plain text is read as Markdown, a URL pasted over a selection turns it into a
 * link, and anything else is left to ProseMirror. The decision is a pure
 * function of the clipboard and the selection, so every case is a table test
 * rather than a simulated paste.
 *
 * Markdown is taken from the paste event itself, before ProseMirror reads the
 * clipboard: ProseMirror would otherwise build a paragraph per line of the
 * text first, only for this to throw it away and parse the text again — for a
 * large paste, most of its cost (quill-plan.md section 31). A paste is parsed
 * once and converted once. One of more than `LARGE_PASTE_CHARS` is parsed off
 * the main thread (`markdown-parser.ts`): the selection is held, mapped through
 * whatever the writer does meanwhile, and replaced when the blocks arrive, and
 * a quiet "Pasting…" appears where they will land if that takes longer than
 * `PASTE_PROGRESS_DELAY_MS`. Escape abandons it.
 */

/** A bare absolute web address and nothing else, which is what a paste of a link is. */
const URL_ONLY = /^https?:\/\/\S+$/

/**
 * Above this many characters a paste is parsed off the main thread. Parsing
 * runs at roughly three microseconds a character, so this is the largest
 * paste parsed in the page within the 50 ms a task may take.
 */
export const LARGE_PASTE_CHARS = 16_384

/** How long a paste may take before it says it is still going. */
export const PASTE_PROGRESS_DELAY_MS = 300

export type PasteAction =
  | { readonly kind: 'default' }
  | { readonly kind: 'link'; readonly href: string }
  | { readonly kind: 'markdown'; readonly text: string }

export interface PasteInput {
  readonly text: string
  /** Rich clipboard content, which ProseMirror already knows how to read. */
  readonly html: string
  /** Inside a code block or another code node, text is text and nothing else. */
  readonly inCode: boolean
  readonly hasSelection: boolean
  /** A copied picture or file, which the file handler takes (`files.ts`). */
  readonly hasFiles: boolean
}

export function choosePaste(input: PasteInput): PasteAction {
  const text = input.text.trim()
  if (input.inCode || input.hasFiles || text.length === 0) return { kind: 'default' }
  if (input.hasSelection && URL_ONLY.test(text)) return { kind: 'link', href: text }
  if (input.html.length > 0) return { kind: 'default' }
  return { kind: 'markdown', text: input.text }
}

function inputFrom(state: EditorState, event: ClipboardEvent): PasteInput {
  const data = event.clipboardData
  const inCode = state.selection.$from.parent.type.spec.code === true
  return {
    text: data?.getData('text/plain') ?? '',
    html: data?.getData('text/html') ?? '',
    inCode,
    hasSelection: !state.selection.empty,
    hasFiles: chooseFiles({ files: [...(data?.files ?? [])], inCode }).kind === 'files',
  }
}

/** A large paste on its way: where it lands, and whether it has said so yet. */
export interface PendingPaste {
  readonly id: number
  /** The selection it replaces, mapped through every edit since. */
  readonly selection: Selection
  readonly shown: boolean
}

/** What a transaction tells the pending paste: it began, it is slow, or it is over. */
type PasteMeta =
  | { readonly kind: 'start'; readonly pending: PendingPaste }
  | { readonly kind: 'show'; readonly id: number }
  | { readonly kind: 'settle'; readonly id: number }

export const pasteKey = new PluginKey<PendingPaste | null>('editorPaste')

function isPasteMeta(value: unknown): value is PasteMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'start' || value.kind === 'show' || value.kind === 'settle')
  )
}

function nextPending(pending: PendingPaste | null, transaction: Transaction): PendingPaste | null {
  const value: unknown = transaction.getMeta(pasteKey)
  const change = isPasteMeta(value) ? value : undefined
  if (change?.kind === 'start') return change.pending
  if (pending === null) return null
  if (change?.kind === 'settle') return null
  // Only the paste on its way is ever told to show (`pasteLater` checks).
  const shown = pending.shown || change?.kind === 'show'
  const selection = pending.selection.map(transaction.doc, transaction.mapping)
  return shown === pending.shown && selection.eq(pending.selection)
    ? pending
    : { ...pending, selection, shown }
}

const progress = tv({
  base: 'paste-progress ms-1 rounded-sm px-1 text-xs text-muted motion-safe:animate-pulse',
})

function progressWidget(): HTMLElement {
  const element = document.createElement('span')
  element.className = progress()
  element.setAttribute('role', 'status')
  element.setAttribute('contenteditable', 'false')
  element.textContent = 'Pasting…'
  return element
}

let pastes = 0

/** Parses `markdown` off the main thread and puts it where the selection was. */
function pasteLater(view: EditorView, markdown: string, parse: ParseMarkdown): void {
  pastes += 1
  const id = pastes
  const pending = (): PendingPaste | null =>
    view.isDestroyed ? null : (pasteKey.getState(view.state) ?? null)
  view.dispatch(
    view.state.tr.setMeta(pasteKey, {
      kind: 'start',
      pending: { id, selection: view.state.selection, shown: false },
    }),
  )
  const timer = setTimeout(() => {
    if (pending()?.id === id) view.dispatch(view.state.tr.setMeta(pasteKey, { kind: 'show', id }))
  }, PASTE_PROGRESS_DELAY_MS)
  void parse(markdown).then((ast) => {
    clearTimeout(timer)
    const landing = pending()
    if (landing?.id !== id) return
    const { state } = view
    const tr = state.tr.setSelection(landing.selection)
    view.dispatch(
      replaceSelectionWithFragment(tr, astFragment(ast, state.schema))
        .setMeta(pasteKey, { kind: 'settle', id })
        .setMeta('uiEvent', 'paste')
        .scrollIntoView(),
    )
  })
}

export interface MarkdownPasteOptions {
  /** Where a large paste is parsed: the page's worker unless a test supplies its own. */
  readonly parse: ParseMarkdown | undefined
}

export const MarkdownPaste = Extension.create<MarkdownPasteOptions>({
  name: 'markdownPaste',
  addOptions: () => ({ parse: undefined }),
  addProseMirrorPlugins() {
    const parse = (): ParseMarkdown => this.options.parse ?? pageMarkdownParser()
    return [
      new Plugin<PendingPaste | null>({
        key: pasteKey,
        state: {
          init: () => null,
          apply: (transaction, pending) => nextPending(pending, transaction),
        },
        props: {
          decorations: (state) => {
            const pending = pasteKey.getState(state)
            if (pending?.shown !== true) return null
            const at = pending.selection.to
            return DecorationSet.create(state.doc, [
              Decoration.widget(at, progressWidget, {
                side: 1,
                key: `paste-${String(pending.id)}`,
              }),
            ])
          },
          handleKeyDown: (view, event) => {
            const pending = pasteKey.getState(view.state)
            if (event.key !== 'Escape' || pending == null) return false
            view.dispatch(view.state.tr.setMeta(pasteKey, { kind: 'settle', id: pending.id }))
            return true
          },
          handleDOMEvents: {
            paste: (view, event) => {
              if (!view.editable) return false
              const action = choosePaste(inputFrom(view.state, event))
              if (action.kind === 'default') return false
              event.preventDefault()
              if (action.kind === 'link') return setLink(action.href)(view.state, view.dispatch)
              if (action.text.length > LARGE_PASTE_CHARS) {
                pasteLater(view, action.text, parse())
                return true
              }
              return insertMarkdown(action.text)(view.state, view.dispatch)
            },
          },
        },
      }),
    ]
  },
})
