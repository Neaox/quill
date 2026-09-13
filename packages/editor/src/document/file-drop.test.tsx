import { EditorState } from '@tiptap/pm/state'
import type { Plugin } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { editorSchema } from '../schema/editor-schema.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { DocumentEditor } from './document-editor.tsx'
import { fileDrop, fileDropKey } from './files.ts'
import type { FileRequest } from './files.ts'

/**
 * The plugin, driven through a real ProseMirror view with real events, because
 * what is worth proving here is the wiring: that a drop is intercepted rather
 * than left to the browser, that the caret moves to where the file landed, and
 * that a code block is left alone. The decision itself is `chooseFiles`, which
 * `files.test.ts` covers as a table.
 */

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function mounted(onFiles: (request: FileRequest) => void, markdown = 'A paragraph.') {
  const extension = fileDrop({ onFiles })
  // `Extension.create` gives a TipTap extension; the plugins inside it are what
  // a bare ProseMirror view takes.
  const plugins = (
    extension.config.addProseMirrorPlugins as unknown as () => readonly Plugin[]
  ).call({ editor: null, options: {}, storage: {} })

  const state = EditorState.create({
    doc: editorSchema.node('doc', null, [
      editorSchema.node('paragraph', null, [editorSchema.text(markdown)]),
    ]),
    plugins: [...plugins],
  })
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, { state })
  views.push(view)
  return view
}

function codeMounted(onFiles: (request: FileRequest) => void) {
  const extension = fileDrop({ onFiles })
  const plugins = (
    extension.config.addProseMirrorPlugins as unknown as () => readonly Plugin[]
  ).call({ editor: null, options: {}, storage: {} })
  const state = EditorState.create({
    doc: editorSchema.node('doc', null, [
      editorSchema.node('codeBlock', null, [editorSchema.text('const a = 1')]),
    ]),
    plugins: [...plugins],
  })
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, { state })
  views.push(view)
  return view
}

function pngFile(name = 'diagram.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })
}

/** A `DataTransfer` jsdom will carry; its own implementation has no file list. */
function transfer(...files: readonly File[]): DataTransfer {
  return {
    files: Object.assign(files.slice(), {
      item: (index: number) => files[index] ?? null,
    }) as unknown as FileList,
    getData: () => '',
    types: files.length === 0 ? [] : ['Files'],
  } as unknown as DataTransfer
}

/**
 * jsdom lays nothing out, so `posAtCoords` finds nothing and ProseMirror's own
 * drop handler returns before it consults `handleDrop`. Answering with a real
 * position is what makes the drop path reachable at all here.
 */
function withCoordinates(view: EditorView): EditorView {
  view.posAtCoords = () => ({ pos: 1, inside: 0 })
  return view
}

function drop(view: EditorView, data: DataTransfer): DragEvent {
  withCoordinates(view)
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { value: data })
  Object.defineProperty(event, 'clientX', { value: 10 })
  Object.defineProperty(event, 'clientY', { value: 10 })
  view.dom.dispatchEvent(event)
  return event
}

function paste(view: EditorView, data: DataTransfer): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: data })
  view.dom.dispatchEvent(event)
  return event
}

describe('the file drop plugin', () => {
  it('has a key, so another plugin can find its state', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    const view = mounted(onFiles)
    // `getState` answers `undefined` rather than throwing only when the plugin
    // really is in this state's plugin list, which is what the key is for.
    expect(fileDropKey.get(view.state)).toBeDefined()
  })

  it('raises a dropped file instead of letting the browser open it', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    const view = mounted(onFiles)
    const file = pngFile()

    const event = drop(view, transfer(file))

    expect(onFiles).toHaveBeenCalledWith({ files: [file] })
    expect(event.defaultPrevented).toBe(true)
  })

  it('raises a pasted file', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    const view = mounted(onFiles)
    const file = pngFile('screenshot.png')

    const event = paste(view, transfer(file))

    expect(onFiles).toHaveBeenCalledWith({ files: [file] })
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a drop with no files to the browser', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    const view = mounted(onFiles)

    drop(view, transfer())
    paste(view, transfer())

    expect(onFiles).not.toHaveBeenCalled()
  })

  it('leaves a file dropped into a code block alone', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    const view = codeMounted(onFiles)

    drop(view, transfer(pngFile()))
    paste(view, transfer(pngFile()))

    expect(onFiles).not.toHaveBeenCalled()
  })

  it('survives an event with no transfer at all', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    const view = mounted(onFiles)

    withCoordinates(view)
    const dropped = new Event('drop', { bubbles: true, cancelable: true })
    view.dom.dispatchEvent(dropped)
    const pasted = new Event('paste', { bubbles: true, cancelable: true })
    view.dom.dispatchEvent(pasted)

    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('the editor, wired up', () => {
  const harness = createEditorTestHarness()

  it('hands a pasted file to the application rather than dealing with it', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    render(<DocumentEditor ast={harness.open('A paragraph.\n')} onFiles={onFiles} />)
    const surface = screen.getByRole('textbox', { name: 'Document' })
    const file = pngFile('screenshot.png')

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: transfer(file) })
    surface.dispatchEvent(event)

    expect(onFiles).toHaveBeenCalledWith({ files: [file] })
  })

  it('leaves a paste with no files to the rest of the editor', () => {
    const onFiles = vi.fn<(request: FileRequest) => void>()
    render(<DocumentEditor ast={harness.open('A paragraph.\n')} onFiles={onFiles} />)
    const surface = screen.getByRole('textbox', { name: 'Document' })

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: transfer() })
    surface.dispatchEvent(event)

    expect(onFiles).not.toHaveBeenCalled()
  })
})
