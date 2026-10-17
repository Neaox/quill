import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorState } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { drawioImageAction, drawioSlashContribution } from '../extensions/drawio/drawio-binding.ts'
import { createSlashRegistry } from '../slash/slash-registry.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import type { ImageAction, ImageRef } from './image-actions.ts'
import { setImageSource } from './image-actions.ts'
import { insertImage } from '../document/commands.ts'

const DIAGRAM = '/api/attachments/3c9e1f4a-7b2d-4e8f-a1c6-5d0b9e2f8a17'
const PHOTO = '/api/attachments/6f1d2b0e-5c3a-4b7e-9d21-0a8c4f3e7b19'

const SOURCE = `Intro.\n\n![Request path](${DIAGRAM} "How a request moves")\n\n![A photo](${PHOTO})\n\n![](${PHOTO})\n`

/** The set of diagram addresses the application keeps, which can change while the editor is open. */
function diagramStore(initial: readonly string[]) {
  const diagrams = new Set(initial)
  const versions = new Map<string, number>()
  const listeners = new Set<() => void>()
  return {
    add(src: string, version: number) {
      diagrams.add(src)
      versions.set(src, version)
      for (const listener of listeners) listener()
    },
    listeners,
    options: {
      isDiagram: (src: string) => diagrams.has(src),
      displaySrc: (src: string) => (versions.has(src) ? `${src}?v=${versions.get(src)}` : src),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
}

function open(actions: readonly ImageAction[], source = SOURCE) {
  const ref = createRef<DocumentEditorHandle>()
  const view = render(
    <DocumentEditor ast={parseDocument(source).ast} ref={ref} imageActions={actions} />,
  )
  const editor = () => {
    const current = ref.current?.editor
    if (current === undefined || current === null) throw new Error('no editor')
    return current
  }
  const markdown = () => {
    const handle = ref.current
    if (handle === null) throw new Error('no handle')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { ...view, editor, markdown }
}

/** Where the first image in the document is. */
function firstImage(editor: { readonly state: EditorState }): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === 'image') at = pos
    return at === -1
  })
  if (at === -1) throw new Error('There is no image.')
  return at
}

describe('image actions', () => {
  it('offers "Edit diagram" on a draw.io diagram, not on a photo, and passes axe', async () => {
    const onEdit = vi.fn<(image: ImageRef) => void>()
    const store = diagramStore([DIAGRAM])
    const { container, markdown } = open([drawioImageAction({ ...store.options, onEdit })])

    const buttons = screen.getAllByRole('button', { name: 'Edit diagram' })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0] ?? document.body)
    expect(onEdit).toHaveBeenCalledWith({
      src: DIAGRAM,
      alt: 'Request path',
      title: 'How a request moves',
      pos: expect.any(Number),
    })
    expect(screen.getByRole('img', { name: 'A photo' })).toHaveAttribute('src', PHOTO)
    expect(markdown()).toContain(`![Request path](${DIAGRAM} "How a request moves")`)
    await expectNoAccessibilityViolations(container)
  })

  it('re-asks when the application says what it knows has changed, and draws a re-saved diagram fresh', () => {
    const store = diagramStore([])
    const { markdown } = open([drawioImageAction({ ...store.options, onEdit: () => {} })])
    expect(screen.queryByRole('button', { name: 'Edit diagram' })).not.toBeInTheDocument()

    act(() => store.add(DIAGRAM, 2))

    expect(screen.getByRole('button', { name: 'Edit diagram' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Request path' })).toHaveAttribute(
      'src',
      `${DIAGRAM}?v=2`,
    )
    expect(markdown()).toContain(`](${DIAGRAM} "How a request moves")`)
  })

  it('points an image somewhere else in place, keeping its words', () => {
    const store = diagramStore([DIAGRAM])
    const { editor, markdown } = open([drawioImageAction({ ...store.options, onEdit: () => {} })])
    let pos = -1
    editor().state.doc.descendants((node, at) => {
      if (node.type.name === 'image' && node.attrs['src'] === DIAGRAM) pos = at
    })

    act(() => {
      expect(
        editor().commands.command(({ state, dispatch }) =>
          setImageSource(pos, PHOTO)(state, dispatch),
        ),
      ).toBe(true)
    })
    expect(markdown()).toContain(`![Request path](${PHOTO} "How a request moves")`)
    expect(setImageSource(0, PHOTO)(editor().state)).toBe(false)
    expect(setImageSource(10_000, PHOTO)(editor().state)).toBe(false)
    expect(setImageSource(-1, PHOTO)(editor().state)).toBe(false)
  })

  it('stops listening when the editor goes', () => {
    const store = diagramStore([DIAGRAM])
    const { unmount } = open([drawioImageAction({ ...store.options, onEdit: () => {} })])
    expect(store.listeners.size).toBeGreaterThan(0)
    unmount()
    expect(store.listeners.size).toBe(0)
  })

  it('draws images as before when no extension offers an action', () => {
    open([])
    expect(screen.queryByRole('button', { name: 'Edit diagram' })).not.toBeInTheDocument()
    expect(document.querySelector('.image-actions')).toBeNull()
    expect(screen.getByRole('img', { name: 'A photo' })).toHaveAttribute('src', PHOTO)
  })

  it('runs nothing from a button whose image has left the document', () => {
    const onEdit = vi.fn<(image: ImageRef) => void>()
    const { editor } = open([drawioImageAction({ isDiagram: () => true, onEdit })])
    const [stale] = screen.getAllByRole('button', { name: 'Edit diagram' })
    if (stale === undefined) throw new Error('no button')

    const at = firstImage(editor())
    act(() => {
      editor().view.dispatch(editor().state.tr.delete(at, at + 1))
    })
    stale.click()

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('works without a way to hear about changes', () => {
    const { editor } = open([drawioImageAction({ isDiagram: () => true, onEdit: () => {} })])
    expect(screen.getAllByRole('button', { name: 'Edit diagram' })).toHaveLength(3)
    act(() => {
      editor().commands.command(({ state, dispatch }) =>
        insertImage({ src: DIAGRAM })(state, dispatch),
      )
    })
    expect(screen.getAllByRole('button', { name: 'Edit diagram' })).toHaveLength(4)
  })
})

describe('the draw.io slash item', () => {
  it('is named by the extension, sits with the diagrams, and asks the application to open the editor', () => {
    const onInsert = vi.fn<() => void>()
    let enabled = false
    const registry = createSlashRegistry({
      contributions: [drawioSlashContribution({ onInsert, enabled: () => enabled })],
    })
    const item = registry.findSlashItem('drawio')

    expect(item).toMatchObject({
      label: 'Draw.io diagram',
      group: 'Media and diagrams',
      keywords: expect.arrayContaining(['drawio', 'diagrams.net']),
    })
    const state = EditorState.create({
      doc: editorSchema.node('doc', null, [editorSchema.node('paragraph')]),
    })
    expect(item?.available?.({ state, inTableCell: false })).toBe(false)
    enabled = true
    expect(item?.available?.({ state, inTableCell: false })).toBe(true)
    item?.run({ state, dispatch: () => {}, request: () => {}, pick: () => {} })
    expect(onInsert).toHaveBeenCalledOnce()

    const always = createSlashRegistry({
      contributions: [drawioSlashContribution({ onInsert })],
    }).findSlashItem('drawio')
    expect(always?.available?.({ state, inTableCell: false })).toBe(true)
  })
})
