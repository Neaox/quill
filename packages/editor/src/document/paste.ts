import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

import { insertMarkdown, setLink } from './commands.ts'
import { chooseFiles } from './files.ts'
import { pageIdleQueue } from './idle-queue.ts'
import {
  endLargePaste,
  escapeLargePaste,
  joinLandingPaste,
  nextPending,
  pasteDecorations,
  pasteKey,
  startLargePaste,
} from './large-paste.ts'
import type { LargePasteContext, PendingPaste } from './large-paste.ts'
import { pageMarkdownParser, warmMarkdownParser } from './markdown-parser.ts'
import type { ParseMarkdown } from './markdown-parser.ts'
import { createPasteAnnouncer } from './paste-status.ts'
import { browserSliceHost, createSlicer } from './time-slice.ts'
import type { SliceHost } from './time-slice.ts'

export { isPasteLanding, pasteKey, PASTE_SETTLED_MS } from './large-paste.ts'
export type { PendingPaste } from './large-paste.ts'

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
 * once and converted once. One of more than `LARGE_PASTE_CHARS` is parsed in
 * pieces off the main thread and lands a batch at a time behind a "Pasting…"
 * card (`large-paste.ts`).
 */

/** A bare absolute web address and nothing else, which is what a paste of a link is. */
const URL_ONLY = /^https?:\/\/\S+$/

/**
 * Above this many characters a paste is parsed off the main thread. Parsing
 * runs at roughly three microseconds a character, so this is the largest
 * paste parsed in the page within the 50 ms a task may take.
 */
export const LARGE_PASTE_CHARS = 16_384

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

export interface MarkdownPasteOptions {
  /** Where a large paste is parsed: the page's workers unless a test supplies its own. */
  readonly parse: ParseMarkdown | undefined
  /** The page's clock and turns, unless a test supplies its own. */
  readonly host: SliceHost | undefined
}

export const MarkdownPaste = Extension.create<MarkdownPasteOptions>({
  name: 'markdownPaste',
  addOptions: () => ({ parse: undefined, host: undefined }),
  dispatchTransaction({ transaction, next }) {
    joinLandingPaste(this.editor.view, transaction)
    next(transaction)
  },
  addProseMirrorPlugins() {
    const parse = (): ParseMarkdown => this.options.parse ?? pageMarkdownParser()
    const ownParser = this.options.parse === undefined
    const host = this.options.host ?? browserSliceHost(globalThis)
    const contexts = new WeakMap<object, LargePasteContext>()
    return [
      new Plugin<PendingPaste | null>({
        key: pasteKey,
        state: {
          init: () => null,
          apply: (transaction, pending) => nextPending(pending, transaction),
        },
        view: (view) => {
          const context: LargePasteContext = {
            host,
            announcer: createPasteAnnouncer(view.dom.ownerDocument),
            slicer: createSlicer(),
          }
          contexts.set(view, context)
          // A worker is started while the page is idle, so the first large
          // paste does not wait for one to load.
          const cancelWarm = ownParser
            ? pageIdleQueue().schedule(warmMarkdownParser, 'background')
            : undefined
          return {
            update: (updated, previous) => {
              const before = pasteKey.getState(previous)
              if (before == null || before === pasteKey.getState(updated.state)) return
              // A paste that failed is taken back and shown again with the
              // same card in one task, so the card is let go only if it is
              // still not shown once the task is over.
              queueMicrotask(() => {
                if (pasteKey.getState(updated.state)?.status !== before.status) {
                  before.status.dispose()
                }
              })
            },
            destroy: () => {
              cancelWarm?.()
              pasteKey.getState(view.state)?.status.dispose()
              endLargePaste(view)
              context.announcer.release()
            },
          }
        },
        props: {
          decorations: (state) => pasteDecorations(state),
          handleKeyDown: (view, event) => {
            const context = contexts.get(view)
            if (event.key !== 'Escape' || context === undefined) return false
            return escapeLargePaste(view, context)
          },
          handleDOMEvents: {
            paste: (view, event) => {
              if (!view.editable) return false
              const action = choosePaste(inputFrom(view.state, event))
              if (action.kind === 'default') return false
              event.preventDefault()
              if (action.kind === 'link') return setLink(action.href)(view.state, view.dispatch)
              const context = contexts.get(view)
              if (action.text.length > LARGE_PASTE_CHARS && context !== undefined) {
                startLargePaste(view, action.text, parse(), context)
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
