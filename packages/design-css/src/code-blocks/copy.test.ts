// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClipboardWriter } from './copy.ts'
import {
  announce,
  codeSource,
  COPIED_MS,
  copyShortcut,
  createCopyButton,
  FAILED_MS,
  selectionWithin,
  writeClipboard,
} from './copy.ts'

function block(text = 'const a = 1\nconst b = 2'): HTMLElement {
  document.body.innerHTML = `<p id="outside">Before</p><pre><code>${text}</code></pre>`
  const code = document.querySelector('code')
  if (code === null) throw new Error('no code')
  return code
}

function select(node: Node, start: number, end: number, endNode: Node = node): void {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(endNode, end)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function clipboard(): ClipboardWriter & { readonly written: string[] } {
  const written: string[] = []
  return {
    written,
    writeText: async (text) => {
      written.push(text)
    },
  }
}

const refusing: ClipboardWriter = {
  writeText: async () => {
    throw new DOMException('Denied', 'NotAllowedError')
  },
}

/** Runs the animation frame the live region waits for. */
async function frame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

beforeEach(() => {
  document.getSelection()?.removeAllRanges()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('the copy button', () => {
  it('names what it copies', () => {
    const code = block()
    const button = createCopyButton(document, { source: codeSource(() => code) })
    expect(button.element.getAttribute('aria-label')).toBe('Copy code')
    expect(button.element.type).toBe('button')

    button.setLanguage('TypeScript')
    expect(button.element.getAttribute('aria-label')).toBe('Copy TypeScript code')

    button.setMode('selection')
    button.setMode('selection')
    expect(button.element.getAttribute('aria-label')).toBe('Copy selection')
    expect(button.element.dataset['mode']).toBe('selection')
    expect(button.element.textContent).toBe('Copy selection')
  })

  it('copies the block’s exact text, confirms, and offers itself again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const code = block()
    const board = clipboard()
    const button = createCopyButton(document, {
      source: codeSource(() => code),
      language: 'TypeScript',
      clipboard: board,
    })
    document.body.append(button.element)

    expect(await button.copy()).toBe('copied')
    expect(board.written).toEqual(['const a = 1\nconst b = 2'])
    expect(button.element.dataset['state']).toBe('copied')
    expect(button.element.getAttribute('aria-label')).toBe('Copied')
    expect(button.element.querySelector('svg')).not.toBeNull()
    await frame()
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Copied')

    vi.advanceTimersByTime(COPIED_MS)
    expect(button.element.dataset['state']).toBe('idle')
    expect(button.element.getAttribute('aria-label')).toBe('Copy TypeScript code')
  })

  it('copies only a selection made inside the block', async () => {
    const code = block()
    const board = clipboard()
    const button = createCopyButton(document, { source: codeSource(() => code), clipboard: board })
    const text = code.firstChild
    if (text === null) throw new Error('no text')

    select(text, 6, 11)
    await button.copy()
    expect(board.written).toEqual(['a = 1'])
    await frame()
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Selection copied')

    // A selection that spills out of the block copies the whole block.
    const outside = document.getElementById('outside')?.firstChild
    if (outside === null || outside === undefined) throw new Error('no outside')
    select(outside, 0, 4, text)
    await button.copy()
    expect(board.written.at(-1)).toBe('const a = 1\nconst b = 2')
  })

  it('selects the code and says which keys copy it when the clipboard is refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const code = block()
    const button = createCopyButton(document, {
      source: codeSource(() => code),
      clipboard: refusing,
    })

    expect(await button.copy()).toBe('failed')
    expect(button.element.dataset['state']).toBe('failed')
    expect(button.element.getAttribute('aria-label')).toMatch(/^Press (Ctrl\+C|⌘C) to copy$/u)
    expect(document.getSelection()?.toString()).toBe('const a = 1\nconst b = 2')

    vi.advanceTimersByTime(FAILED_MS)
    expect(button.element.dataset['state']).toBe('idle')
  })

  it('keeps a selection the reader made when the clipboard is refused', async () => {
    const code = block()
    const button = createCopyButton(document, {
      source: codeSource(() => code),
      clipboard: refusing,
    })
    const text = code.firstChild
    if (text === null) throw new Error('no text')
    select(text, 0, 5)

    await button.copy()
    expect(document.getSelection()?.toString()).toBe('const')
  })

  it('copies on a click, and keeps the selection a press would take away', async () => {
    const code = block()
    const board = clipboard()
    const button = createCopyButton(document, { source: codeSource(() => code), clipboard: board })
    document.body.append(button.element)

    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.element.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    button.element.click()
    await vi.waitFor(() => {
      expect(board.written).toHaveLength(1)
    })

    button.dispose()
    expect(button.element.isConnected).toBe(false)
  })

  it('uses the page’s own clipboard by default, and fails without one', async () => {
    const code = block()
    const button = createCopyButton(document, { source: codeSource(() => code) })
    expect(await button.copy()).toBe(navigator.clipboard === undefined ? 'failed' : 'copied')
  })
})

describe('copy helpers', () => {
  it('names the copy shortcut by platform', () => {
    expect(copyShortcut('MacIntel')).toBe('⌘C')
    expect(copyShortcut('iPhone')).toBe('⌘C')
    expect(copyShortcut('Win32')).toBe('Ctrl+C')
  })

  it('reports whether the clipboard took the text', async () => {
    expect(await writeClipboard('x', undefined)).toBe(false)
    expect(await writeClipboard('x', refusing)).toBe(false)
    expect(await writeClipboard('x', clipboard())).toBe(true)
  })

  it('announces at once where the document has no window, and reuses its region', () => {
    const detached = document.implementation.createHTMLDocument('')
    announce(detached, 'Copied')
    announce(detached, 'Copied again')
    expect(detached.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(detached.querySelector('[aria-live="polite"]')?.textContent).toBe('Copied again')
  })

  it('finds no selection in a caret, an empty page or another element', () => {
    const code = block()
    expect(selectionWithin(document, code)).toBeNull()
    const text = code.firstChild
    if (text === null) throw new Error('no text')
    select(text, 2, 2)
    expect(selectionWithin(document, code)).toBeNull()
    select(text, 2, 4)
    expect(selectionWithin(document, code)?.toString()).toBe('ns')
    expect(selectionWithin(document, document.getElementById('outside') ?? code)).toBeNull()
  })
})
