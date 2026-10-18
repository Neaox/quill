import { parseMarkdown, serializeDocument } from '@quill/markdown'
import { blocksFromMdast } from '@quill/markdown/blocks'
import { within } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { undo } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from './ast.ts'
import { insertMarkdown } from './commands.ts'
import { buildExtensions } from './extensions.ts'
import type { ParseMarkdown, PasteBatch } from './markdown-parser.ts'
import {
  LARGE_PASTE_CHARS,
  MarkdownPaste,
  PASTE_SETTLED_MS,
  isPasteLanding,
  pasteKey,
} from './paste.ts'
import type { SliceHost } from './time-slice.ts'

/**
 * The paste handler, driven by real paste events through a real editor. The
 * decision is `choosePaste`, which `paste.test.ts` covers as a table; this is
 * the wiring around it: that Markdown is read from the event before
 * ProseMirror reads the clipboard, and that a large paste is parsed elsewhere
 * and lands where the selection was, a batch at a time, whatever happened
 * meanwhile, with a card that says how it is going (quill-plan.md section 31).
 */

const harness = createEditorTestHarness()
const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  vi.useRealTimers()
})

/** The blocks a clipboard's Markdown becomes. */
const blocks = (markdown: string) => blocksFromMdast(parseMarkdown(markdown).children)

/** Slices give way for a microtask (`host`), so a run of them settles in microtasks. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 200; turn += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one microtask at a time, on purpose
    await Promise.resolve()
  }
}

/**
 * A parser that hands over the paste's blocks when the test says so: a batch
 * per paragraph-sized group, as the worker pool hands over a piece at a time.
 */
function heldParser() {
  const held: {
    batches: PasteBatch[]
    onBatch(batch: PasteBatch): void
    resolve(): void
    reject(error: Error): void
    signal: AbortSignal
  }[] = []
  const parse: ParseMarkdown = (markdown, onBatch, signal) =>
    new Promise((resolve, reject) => {
      const all = blocks(markdown)
      const size = Math.max(1, Math.ceil(all.length / 4))
      const batches: PasteBatch[] = []
      for (let start = 0; start < all.length; start += size) {
        batches.push({
          blocks: all.slice(start, start + size),
          progress: Math.min(1, (start + size) / all.length),
        })
      }
      held.push({ batches, onBatch, resolve, reject, signal })
    })
  return {
    parse,
    held,
    blocks,
    /** Hands over the next `count` batches of the newest paste still open. */
    async release(count: number) {
      const request = held.at(-1)
      const batches = request?.batches.splice(0, count) ?? []
      for (const batch of batches) {
        if (request?.signal.aborted === false) request.onBatch(batch)
      }
      await settle()
    },
    /** Says the newest paste has been handed over whole. */
    async finish() {
      held.pop()?.resolve()
      await settle()
    },
    /** Says the newest paste cannot be parsed. */
    async fail() {
      held.pop()?.reject(new Error('unreadable'))
      await settle()
    },
  }
}

/** Time and turns, at once: each slice gives way for no longer than a microtask. */
const host: SliceHost = { now: () => performance.now(), yield: () => Promise.resolve() }

/** The paste's card, which the test expects to be there. */
function cardOf(editor: Editor): HTMLElement {
  const card = editor.view.dom.querySelector<HTMLElement>('.paste-status')
  if (card === null) throw new Error('No paste card.')
  return card
}

/** What the page's live region of `role` last said. */
function announced(role: 'status' | 'alert'): string {
  return document.querySelector(`[data-paste-announcer="${role}"]`)?.textContent ?? ''
}

function open(markdown: string, parse?: ParseMarkdown, editable = true) {
  const extensions = buildExtensions({ files: { onFiles: () => undefined } }).map((extension) =>
    extension.name === MarkdownPaste.name ? MarkdownPaste.configure({ parse, host }) : extension,
  )
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions,
    editable,
    content: harness.state(markdown).doc.toJSON(),
  })
  editors.push(editor)
  return editor
}

function paste(editor: Editor, data: Record<string, string>, files: readonly File[] = []) {
  const clipboardData = new DataTransfer()
  for (const [type, value] of Object.entries(data)) clipboardData.setData(type, value)
  Object.defineProperty(clipboardData, 'files', { value: files })
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  return event
}

function written(editor: Editor): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(editor.state.doc).tree })
}

function caretAt(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

/** Markdown longer than the threshold: a heading and enough paragraphs. */
function large(heading: string): string {
  const paragraph = 'A sentence that is long enough to count. '.repeat(10)
  const count = Math.ceil(LARGE_PASTE_CHARS / paragraph.length) + 1
  return [`## ${heading}`, ...Array.from({ length: count }, () => paragraph.trim())].join('\n\n')
}

describe('a paste of Markdown', () => {
  it('becomes blocks, read from the paste event before ProseMirror reads the clipboard', () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    const event = paste(editor, { 'text/plain': '## A heading\n\n- one\n- two\n' })
    expect(event.defaultPrevented).toBe(true)
    expect(written(editor)).toBe('Text.\n\n## A heading\n\n- one\n- two\n')
  })

  it('links the selection when the clipboard is an address', () => {
    const editor = open('Read the docs.\n')
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10, 14)),
    )
    paste(editor, { 'text/plain': 'https://example.com/docs' })
    expect(written(editor)).toBe('Read the [docs](https://example.com/docs).\n')
  })

  describe('an address of another document of this instance', () => {
    const address = '/d/0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'

    it('becomes a link by its id, wherever the address was copied from', () => {
      const editor = open('See \n')
      caretAt(editor, 5)
      const event = paste(editor, { 'text/plain': `${globalThis.location.origin}${address}` })
      expect(event.defaultPrevented).toBe(true)
      expect(written(editor)).toContain(address)
      expect(written(editor)).not.toContain(globalThis.location.origin)
    })

    it('is linked as a plain address where a link by id cannot go', () => {
      const editor = open('::link{url="https://blog.example/post" display=card}\n')
      const beforeCard = editor.state.doc.resolve(0)
      editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(beforeCard)))
      paste(editor, { 'text/plain': `${globalThis.location.origin}${address}` })
      expect(written(editor)).toContain(address)
    })
  })

  it('leaves rich content, a file, and a read-only document to the handlers after it', () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    const rich = paste(editor, {
      'text/plain': 'Bold',
      'text/html': '<p><strong>Bold</strong></p>',
    })
    expect(written(editor)).toContain('**Bold**')
    expect(rich.defaultPrevented).toBe(true)

    const picture = new File(['png'], 'diagram.png', { type: 'image/png' })
    const before = written(editor)
    paste(editor, { 'text/plain': '# Not a heading' }, [picture])
    expect(written(editor)).toBe(before)

    // A paste event with no clipboard at all, which some browsers send.
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }))
    expect(written(editor)).toBe(before)

    const readOnly = open('Text.\n', undefined, false)
    const ignored = paste(readOnly, { 'text/plain': '## A heading' })
    expect(ignored.defaultPrevented).toBe(false)
  })
})

describe('a large paste of Markdown', () => {
  it('is acknowledged in the paste’s own task: a card where it will land, and a status', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Pasted') })
    // Nothing has been parsed, and already the card is in the document's flow.
    const card = cardOf(editor)
    expect(card.textContent).toContain('Pasting…')
    expect(card.getAttribute('data-state')).toBe('landing')
    expect(card.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(within(card).getByRole('button', { name: /Cancel/u })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape',
    )
    await vi.waitFor(() => {
      expect(announced('status')).toBe('Pasting…')
    })
    // It sits between the halves of the paragraph the paste split.
    expect(card.previousElementSibling?.textContent).toBe('Before ')
    expect(card.nextElementSibling?.textContent).toBe('after.')
  })

  it('lands its blocks a batch at a time, and ends as one paste of the whole would', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    const markdown = large('Pasted')
    paste(editor, { 'text/plain': markdown })
    await parser.release(1)
    expect(written(editor)).toContain('## Pasted')
    expect(editor.view.dom.querySelector('.paste-status')?.textContent).toMatch(/Pasting… \d+%/u)
    expect(isPasteLanding(editor.state)).toBe(true)

    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    const whole = open('Before after.\n')
    caretAt(whole, 8)
    insertMarkdown(markdown)(whole.state, whole.view.dispatch)
    expect(written(editor)).toBe(written(whole))
    expect(isPasteLanding(editor.state)).toBe(false)
    const landed = String(blocks(markdown).length)
    expect(editor.view.dom.querySelector('.paste-status')?.textContent).toBe(
      `Pasted ${landed} blocks`,
    )
    await vi.waitFor(() => {
      expect(announced('status')).toBe(`Pasted ${landed} blocks`)
    })
  })

  it('settles: the card goes a moment after the paste has landed', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Settles') })
    await parser.release(Number.POSITIVE_INFINITY)
    vi.useFakeTimers()
    await parser.finish()
    vi.advanceTimersByTime(PASTE_SETTLED_MS)
    expect(editor.view.dom.querySelector('.paste-status')).toBeNull()
    expect(pasteKey.getState(editor.state)).toBeNull()
  })

  it('is taken away by one undo, though it arrived in batches', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Undone') })
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    expect(written(editor)).toContain('## Undone')
    undo(editor.state, editor.view.dispatch)
    expect(written(editor)).toBe('Before after.\n')
  })

  it('keeps its place while the writer types, and one undo still takes the paste away', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Pasted') })
    await parser.release(1)
    // A transaction that moves nothing leaves the pending paste as it was.
    const waiting = pasteKey.getState(editor.state)
    editor.view.dispatch(editor.state.tr.setMeta('unrelated', true))
    expect(pasteKey.getState(editor.state)).toBe(waiting)
    // The writer goes on typing, before the place the paste lands.
    editor.view.dispatch(editor.state.tr.insertText('Just ', 1))
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()

    const text = written(editor)
    expect(text.startsWith('Just Before')).toBe(true)
    expect(text.indexOf('## Pasted')).toBeGreaterThan(text.indexOf('Just Before'))
    expect(text.endsWith('after.\n')).toBe(true)
    undo(editor.state, editor.view.dispatch)
    expect(written(editor)).not.toContain('## Pasted')
  })

  it('is cancelled by Escape, which takes back what had landed', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Cancelled') })
    await parser.release(1)
    expect(written(editor)).toContain('## Cancelled')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(written(editor)).toBe('Before after.\n')
    expect(editor.view.dom.querySelector('.paste-status')).toBeNull()
    await vi.waitFor(() => {
      expect(announced('status')).toBe('Paste cancelled')
    })
    // What arrives afterwards is not put in.
    await parser.release(Number.POSITIVE_INFINITY)
    expect(written(editor)).toBe('Before after.\n')

    // With nothing on its way, Escape is not the paste's to take.
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
  })

  it('is cancelled by its Cancel button, which puts back a selection it replaced', async () => {
    const parser = heldParser()
    const editor = open('Keep this, drop that, keep.\n', parser.parse)
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 12, 22)),
    )
    paste(editor, { 'text/plain': large('Cancelled') })
    await parser.release(1)
    const card = cardOf(editor)
    within(card)
      .getByRole('button', { name: /Cancel/u })
      .click()
    expect(written(editor)).toBe('Keep this, drop that, keep.\n')
  })

  it('takes back what landed when it cannot be read, says so, and can be tried again', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    const markdown = large('Retried')
    paste(editor, { 'text/plain': markdown })
    await parser.release(1)
    await parser.fail()
    expect(written(editor)).toBe('Before after.\n')
    const card = cardOf(editor)
    expect(card.getAttribute('data-state')).toBe('failed')
    await vi.waitFor(() => {
      expect(announced('alert')).toMatch(/could not be read/u)
    })
    expect(isPasteLanding(editor.state)).toBe(false)

    within(card).getByRole('button', { name: 'Try again' }).click()
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    // Where it was pasted the first time: between the halves of the paragraph.
    const text = written(editor)
    expect(text.startsWith('Before')).toBe(true)
    expect(text.indexOf('## Retried')).toBeGreaterThan(0)
    expect(text.endsWith('after.\n')).toBe(true)
  })

  it('is dismissed, once it has failed, by Escape or its Dismiss button', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Failed') })
    await parser.fail()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(editor.view.dom.querySelector('.paste-status')).toBeNull()

    paste(editor, { 'text/plain': large('Failed again') })
    await parser.fail()
    const card = cardOf(editor)
    within(card).getByRole('button', { name: 'Dismiss' }).click()
    expect(editor.view.dom.querySelector('.paste-status')).toBeNull()
    expect(written(editor)).toBe('Text.\n')
  })

  it('ends when an undo takes it away while it lands', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Undone early') })
    await parser.release(1)
    undo(editor.state, editor.view.dispatch)
    expect(written(editor)).toBe('Before after.\n')
    expect(pasteKey.getState(editor.state)).toBeNull()
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    expect(written(editor)).toBe('Before after.\n')
  })

  it('gives way to a newer one, and to the editor going away', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('First') })
    await parser.release(1)
    paste(editor, { 'text/plain': large('Second') })
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    expect(written(editor)).not.toContain('First')
    expect(written(editor)).toContain('## Second')

    const leaving = open('Text.\n', parser.parse)
    paste(leaving, { 'text/plain': large('Gone') })
    leaving.destroy()
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
  })

  it('is parsed by the page when nothing else is given, here in the page itself', async () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('In the page') })
    await vi.waitFor(() => {
      expect(written(editor)).toContain('## In the page')
      expect(isPasteLanding(editor.state)).toBe(false)
    })
  })

  it('passes axe while it lands, and once it has failed', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Accessible') })
    await parser.release(1)
    const card = (): HTMLElement => {
      const element = editor.view.dom.querySelector<HTMLElement>('.paste-status')
      if (element === null) throw new Error('No card.')
      return element
    }
    await expectNoAccessibilityViolations(card())
    await parser.fail()
    await expectNoAccessibilityViolations(card())
  })
})

describe('a large paste meeting the rest of the editor', () => {
  it('when cancelled after the writer typed meanwhile, takes out only what landed', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Pasted') })
    await parser.release(1)
    editor.view.dispatch(editor.state.tr.insertText('Typed ', 1))
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(escape)
    expect(written(editor)).toBe('Typed Before after.\n')
  })

  it('leaves out of its undo step what the writer did not do', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Pasted') })
    await parser.release(1)
    // A collaborator's change, say, and a plugin's change on the back of the writer's.
    editor.view.dispatch(editor.state.tr.insertText('Theirs ', 1).setMeta('addToHistory', false))
    const root = editor.state.tr.insertText('!', 1)
    editor.view.dispatch(
      editor.state.tr.insertText('Appended ', 1).setMeta('appendedTransaction', root),
    )
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    undo(editor.state, editor.view.dispatch)
    expect(written(editor)).toContain('Theirs')
    expect(written(editor)).not.toContain('## Pasted')
  })

  it('brings no front matter, and pastes nothing at all of a file that is only front matter', async () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    const yaml = Array.from({ length: 600 }, (_, index) => `key${String(index)}: ${'v'.repeat(24)}`)
    paste(editor, { 'text/plain': ['---', ...yaml, '---', ''].join('\n') })
    await vi.waitFor(() => {
      expect(pasteKey.getState(editor.state)).toBeNull()
    })
    expect(written(editor)).toBe('Text.\n')

    paste(editor, {
      'text/plain': ['---', ...yaml, '---', '', large('After the matter')].join('\n'),
    })
    await vi.waitFor(() => {
      expect(isPasteLanding(editor.state)).toBe(false)
    })
    expect(written(editor)).toContain('## After the matter')
    expect(written(editor)).not.toContain('key1:')
  })

  it('stops parsing when cancelled before anything has arrived', async () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Never') })
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(written(editor)).toBe('Text.\n')
    expect(editor.view.dom.querySelector('.paste-status')).toBeNull()
  })

  it('takes its Cancel press for itself, not for a click in the document', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Pressed') })
    const cancel = within(cardOf(editor)).getByRole('button', { name: /Cancel/u })
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    cancel.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    // Nor does a click anywhere else on the card reach the editor.
    cardOf(editor).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(editor.state.selection.from).toBe(6)
  })

  it('starts afresh after one an undo took away, and settles a moment after it lands', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Undone') })
    await parser.release(1)
    undo(editor.state, editor.view.dispatch)
    // The undone paste's parse fails late: nothing is left to say so on.
    await parser.fail()
    expect(editor.view.dom.querySelector('.paste-status')).toBeNull()

    paste(editor, { 'text/plain': large('Again') })
    await parser.release(Number.POSITIVE_INFINITY)
    vi.useFakeTimers()
    await parser.finish()
    // A newer paste before the card settles: the older card's moment passes quietly.
    paste(editor, { 'text/plain': large('Newer') })
    vi.advanceTimersByTime(PASTE_SETTLED_MS)
    expect(isPasteLanding(editor.state)).toBe(true)
    vi.useRealTimers()
    await parser.release(Number.POSITIVE_INFINITY)
    await parser.finish()
    expect(written(editor)).toContain('## Newer')
  })

  it('stops landing what is queued once it has failed', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Half') })
    void parser.release(Number.POSITIVE_INFINITY)
    await parser.fail()
    expect(written(editor)).toBe('Text.\n')
    expect(cardOf(editor).getAttribute('data-state')).toBe('failed')
  })

  it('tries a failed paste again once, however often Try again is pressed', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Twice') })
    await parser.fail()
    const retry = within(cardOf(editor)).getByRole('button', { name: 'Try again' })
    retry.click()
    retry.click()
    expect(parser.held).toHaveLength(1)
  })
})
