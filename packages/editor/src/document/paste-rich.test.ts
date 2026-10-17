import { Editor } from '@tiptap/core'
import { DOMParser as ProseMirrorParser } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'

import { editorSchema } from '../schema/editor-schema.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  RICH_PASTE_SECTIONS,
  googleDocsHtml,
  plainText,
  wordHtml,
} from '../testing/paste-fixtures.ts'
import { buildExtensions } from './extensions.ts'

/**
 * What the editor makes of the three clipboards of the paste budget
 * (quill-plan.md section 31): a document copied out of Google Docs, one out
 * of Word, and a long plain-text log. The first two are read through the
 * schema's own HTML rules, which is where a pasted fragment becomes nodes; the
 * third goes through a real editor's paste. What these pin is that every kind
 * of block a long paste mounts arrives, once for each section it was written
 * in, whichever application it came from.
 */

const SECTIONS = 8

/** How many of each node and mark the schema reads out of `html`. */
function readFrom(html: string): Map<string, number> {
  const element = document.createElement('div')
  element.innerHTML = html
  const slice = ProseMirrorParser.fromSchema(editorSchema).parseSlice(element)
  const found = new Map<string, number>()
  const count = (name: string): void => {
    found.set(name, (found.get(name) ?? 0) + 1)
  }
  slice.content.descendants((node) => {
    count(node.type.name)
    for (const mark of node.marks) count(`mark:${mark.type.name}`)
    return true
  })
  return found
}

describe.each([
  ['Google Docs', googleDocsHtml],
  ['Word', wordHtml],
])('a document copied out of %s', (_application, clipboard) => {
  const found = readFrom(clipboard(SECTIONS))

  it('keeps a heading for the title and one for each section', () => {
    expect(found.get('heading')).toBe(SECTIONS + 1)
  })

  it('keeps a table of two rows, and a code block, for each section', () => {
    expect(found.get('table')).toBe(SECTIONS)
    expect(found.get('tableRow')).toBe(SECTIONS * 2)
    expect(found.get('codeBlock')).toBe(SECTIONS)
  })

  it('keeps a link for each section, and an image in every fourth', () => {
    expect(found.get('mark:link')).toBe(SECTIONS)
    expect(found.get('image')).toBe(Math.ceil(SECTIONS / 4))
  })

  it('is as long as it says it is by default', () => {
    expect(readFrom(clipboard()).get('table')).toBe(RICH_PASTE_SECTIONS)
  })
})

describe('a long plain-text log', () => {
  const editors: Editor[] = []

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy()
  })

  it('lands as one paragraph for each run of lines', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({
      element,
      extensions: buildExtensions({ files: { onFiles: () => undefined } }),
      content: createEditorTestHarness().state('\n').doc.toJSON(),
    })
    editors.push(editor)
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', plainText(20))
    Object.defineProperty(clipboardData, 'files', { value: [] })

    editor.view.dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    )

    expect(editor.state.doc.childCount).toBe(4)
  })
})
