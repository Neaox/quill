import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import corpusDiagram from '../../../../markdown/corpus/25-drawio-diagram.drawio.svg?raw'
import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { DrawioEditor } from './drawio-editor.tsx'
import type { DrawioDiagram, DrawioEditorProps, DrawioFiles } from './drawio-editor.tsx'
import { EMPTY_DIAGRAM } from './drawio-protocol.ts'

/**
 * The draw.io session against a fake draw.io: the frame's window is the
 * iframe's own, and the test speaks draw.io's side of the protocol to it —
 * the messages draw.io 32 sends, from its origin and its window — and reads
 * back what Quill sends.
 */

const ORIGIN = 'https://draw.example.com'
const EDITOR_URL = `${ORIGIN}/`

/** The corpus diagram, as draw.io 32 saved it: compressed source, SVG text labels. */
const STORED = corpusDiagram
const EXPORTED =
  '<svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxfile/&gt;"><text>v2</text></svg>'

/** What draw.io saves: a shape from the sidebar, with its own style and HTML label. */
const SAVED =
  '<mxfile><diagram id="p" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="Gateway" style="rounded=1;html=1;" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>'

const EXISTING: DrawioDiagram = { attachmentId: 'a1', url: '/api/attachments/a1', version: 3 }

// jsdom has no modal dialogs; the shims do what the browser's do, minus the top layer.
function showModal(this: HTMLDialogElement): void {
  this.setAttribute('open', '')
}

function close(this: HTMLDialogElement): void {
  this.removeAttribute('open')
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = close
})

/** A message as the browser delivers one from a window on an origin. */
function deliver(message: object, origin: string, source: Window): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(message), origin, source }),
    )
  })
}

afterEach(() => {
  vi.useRealTimers()
})

function fakeFiles(overrides: Partial<DrawioFiles> = {}): DrawioFiles {
  return {
    read: vi.fn<DrawioFiles['read']>(async () => ({ file: STORED, version: 3 })),
    create: vi.fn<DrawioFiles['create']>(async () => ({
      attachmentId: 'new',
      url: '/api/attachments/new',
      version: 1,
    })),
    revise: vi.fn<DrawioFiles['revise']>(async (diagram) => ({
      kind: 'revised',
      diagram: { ...diagram, version: diagram.version + 1 },
    })),
    ...overrides,
  }
}

function open(props: Partial<DrawioEditorProps> = {}) {
  const onSaved = vi.fn<DrawioEditorProps['onSaved']>()
  const onClose = vi.fn<DrawioEditorProps['onClose']>()
  const files = props.files ?? fakeFiles()
  const view = render(
    <DrawioEditor
      editorUrl={EDITOR_URL}
      origin={ORIGIN}
      thirdParty={false}
      dark={false}
      target={{ kind: 'new', title: 'Payment flow' }}
      files={files}
      onSaved={onSaved}
      onClose={onClose}
      {...props}
    />,
  )
  const frame = view.container.ownerDocument.querySelector('iframe')
  const drawio = frame?.contentWindow
  if (frame === null || drawio === null || drawio === undefined) throw new Error('no frame')
  const sent = vi.spyOn(drawio, 'postMessage').mockImplementation(() => {})

  /** A message from draw.io: its origin, its window. */
  const say = (message: object, origin = ORIGIN, source: Window = drawio) => {
    deliver(message, origin, source)
  }
  const actions = () =>
    sent.mock.calls.map(([data, origin]) => ({ ...JSON.parse(String(data)), to: origin }))
  const lastAction = () => actions().at(-1)
  /** draw.io's save of a diagram whose labels are already SVG text: the export follows at once. */
  const save = async (message: { readonly xml: string; readonly exit?: boolean }) => {
    say({ event: 'save', ...message })
    await waitFor(() => expect(lastAction()?.action).toBe('export'))
  }

  return { ...view, frame, say, save, actions, lastAction, files, onSaved, onClose }
}

describe('the draw.io editor', () => {
  it('opens draw.io in embed mode, sandboxed, in the reader’s scheme, and passes axe', async () => {
    const { frame, container } = open({ dark: true })

    expect(screen.getByRole('dialog', { name: 'Draw.io diagram' })).toBeInTheDocument()
    expect(frame).toHaveAttribute('title', 'Draw.io diagram')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(frame).toHaveAttribute('allow', 'clipboard-read; clipboard-write')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    const src = new URL(frame.getAttribute('src') ?? '')
    expect(src.origin).toBe(ORIGIN)
    expect(Object.fromEntries(src.searchParams)).toEqual({
      embed: '1',
      proto: 'json',
      spin: '1',
      saveAndExit: '1',
      noSaveBtn: '0',
      configure: '1',
      dark: '1',
    })
    expect(screen.getByRole('status')).toHaveTextContent('Opening the diagram…')
    // The frame is draw.io's document, on draw.io's origin: axe checks Quill's.
    await expectNoAccessibilityViolations(container.ownerDocument.body, { iframes: false })
  })

  it('speaks the language of the interface around it', () => {
    const { frame } = open({ lang: 'pt-BR' })

    expect(new URL(frame.getAttribute('src') ?? '').searchParams.get('lang')).toBe('pt-br')
  })

  it('inserts: configures, loads an empty diagram, and saves it as a new .drawio.svg', async () => {
    const { say, save, actions, lastAction, files, onSaved } = open()

    say({ event: 'configure' })
    expect(lastAction()).toEqual({
      action: 'configure',
      config: {
        defaultVertexStyle: { convertToSvg: '1' },
        defaultEdgeStyle: { convertToSvg: '1' },
      },
      to: ORIGIN,
    })
    say({ event: 'init' })
    await waitFor(() =>
      expect(lastAction()).toEqual({
        action: 'load',
        xml: EMPTY_DIAGRAM,
        autosave: 1,
        to: ORIGIN,
      }),
    )
    say({ event: 'load', xml: EMPTY_DIAGRAM })
    say({ event: 'autosave', xml: '<mxfile/>' })
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')

    say({ event: 'save', xml: SAVED })
    await waitFor(() => expect(lastAction()?.action).toBe('load'))
    expect(String(lastAction()?.xml)).toContain('style="rounded=1;html=1;convertToSvg=1;"')
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    say({ event: 'load' })
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    expect(lastAction()).toEqual({
      action: 'export',
      format: 'xmlsvg',
      asText: true,
      embedFonts: false,
      spinKey: 'saving',
      to: ORIGIN,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')

    say({ event: 'export', format: 'svg', data: EXPORTED, xml: '<mxfile/>' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(files.create).toHaveBeenCalledWith(EXPORTED, 'payment-flow.drawio.svg')
    expect(onSaved).toHaveBeenCalledWith({
      kind: 'created',
      diagram: { attachmentId: 'new', url: '/api/attachments/new', version: 1 },
    })
    expect(actions()).toContainEqual({ action: 'spinner', show: false, to: ORIGIN })
    expect(lastAction()).toEqual({
      action: 'status',
      modified: false,
      message: 'Saved',
      to: ORIGIN,
    })

    // The next save revises the diagram it just created.
    say({ event: 'autosave', xml: '<mxfile/>' })
    await save({ xml: '<mxfile/>' })
    say({ event: 'export', format: 'svg', data: EXPORTED })
    await waitFor(() =>
      expect(files.revise).toHaveBeenCalledWith(
        { attachmentId: 'new', url: '/api/attachments/new', version: 1 },
        EXPORTED,
      ),
    )
  })

  it('edits: opens the stored diagram with labels set to SVG text, and revises it in place', async () => {
    const { say, save, lastAction, files, onSaved, onClose } = open({
      target: { kind: 'existing', diagram: EXISTING, title: 'Request path' },
    })
    say({ event: 'configure' })
    say({ event: 'init' })

    await waitFor(() => expect(lastAction()?.action).toBe('load'))
    expect(files.read).toHaveBeenCalledWith(EXISTING)
    const loaded = String(lastAction()?.xml)
    expect(loaded).toContain('value="Browser"')
    expect(loaded).toContain('convertToSvg=1;')
    expect(loaded).not.toMatch(/<diagram[^>]*>[A-Za-z0-9+/]/)

    say({ event: 'load' })
    await save({ xml: '<mxfile/>', exit: true })
    say({ event: 'export', format: 'svg', data: EXPORTED })

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(files.revise).toHaveBeenCalledWith(EXISTING, EXPORTED)
    expect(onSaved).toHaveBeenCalledWith({ kind: 'revised', diagram: { ...EXISTING, version: 4 } })
  })

  it('never overwrites a newer revision: it offers a copy, or a reload', async () => {
    const files = fakeFiles({
      revise: vi.fn<DrawioFiles['revise']>(async () => ({ kind: 'conflict', currentVersion: 5 })),
    })
    const { say, save, lastAction, onSaved } = open({
      files,
      target: { kind: 'existing', diagram: EXISTING, title: 'Request path' },
    })
    say({ event: 'configure' })
    say({ event: 'init' })
    await waitFor(() => expect(lastAction()?.action).toBe('load'))
    say({ event: 'load' })
    await save({ xml: '<mxfile/>' })
    say({ event: 'export', format: 'svg', data: EXPORTED })

    const prompt = await screen.findByRole('alertdialog', {
      name: 'Somebody saved a newer version',
    })
    expect(prompt).toHaveTextContent('version 5')
    expect(lastAction()).toEqual({
      action: 'status',
      modified: true,
      message: 'Not saved',
      to: ORIGIN,
    })
    expect(screen.getByRole('button', { name: 'Reload theirs' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Save mine as a copy' }))
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        kind: 'copied',
        diagram: { attachmentId: 'new', url: '/api/attachments/new', version: 1 },
      }),
    )
    expect(files.create).toHaveBeenCalledWith(EXPORTED, 'request-path.drawio.svg')
  })

  it('reloads the newer revision when asked, discarding the writer’s changes', async () => {
    const files = fakeFiles({
      revise: vi.fn<DrawioFiles['revise']>(async () => ({ kind: 'conflict', currentVersion: 5 })),
    })
    const { say, save, lastAction } = open({
      files,
      target: { kind: 'existing', diagram: EXISTING, title: 'Request path' },
    })
    say({ event: 'configure' })
    say({ event: 'init' })
    await waitFor(() => expect(lastAction()?.action).toBe('load'))
    say({ event: 'load' })
    await save({ xml: '<mxfile/>' })
    say({ event: 'export', format: 'svg', data: EXPORTED })
    await userEvent.click(await screen.findByRole('button', { name: 'Reload theirs' }))

    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(lastAction()?.action).toBe('load'))
    expect(screen.getByRole('status')).toHaveTextContent('Opening the diagram…')
  })

  it('asks before Escape closes it with unsaved changes', async () => {
    const { say, onClose } = open()
    say({ event: 'configure' })
    say({ event: 'init' })
    say({ event: 'load' })
    say({ event: 'autosave', xml: '<mxfile/>' })

    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Close without saving?' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Close Draw.io diagram' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes at once when nothing is unsaved, and on draw.io’s own Exit', async () => {
    const first = open()
    first.say({ event: 'configure' })
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(first.onClose).toHaveBeenCalledOnce()
    first.unmount()

    const second = open()
    second.say({ event: 'load' })
    second.say({ event: 'autosave', xml: '<mxfile/>' })
    second.say({ event: 'exit', modified: false })
    expect(second.onClose).toHaveBeenCalledOnce()
  })

  it('acts on nothing from another origin or another window, or of another shape', async () => {
    const { say, actions, frame } = open()
    say({ event: 'configure' }, 'https://evil.example')
    say({ event: 'configure' }, ORIGIN, window)
    say({ event: 'configure', config: 1 }, ORIGIN)
    expect(actions()).toEqual([{ action: 'configure', config: expect.anything(), to: ORIGIN }])
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: '{not json',
          origin: ORIGIN,
          source: frame.contentWindow,
        }),
      )
    })
    expect(actions()).toHaveLength(1)
  })

  it('says so when the editor never answers, and offers only to close', async () => {
    vi.useFakeTimers()
    const { onClose } = open({ timeoutMs: 1000 })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('alertdialog', { name: 'The diagram did not open' })).toHaveTextContent(
      `The diagram editor at ${ORIGIN} did not answer`,
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps unsaved work when a save fails, and tries the save again', async () => {
    const revise = vi
      .fn<DrawioFiles['revise']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ kind: 'revised', diagram: { ...EXISTING, version: 4 } })
    const { say, save, lastAction, onSaved } = open({
      files: fakeFiles({ revise }),
      target: { kind: 'existing', diagram: EXISTING, title: 'Request path' },
    })
    say({ event: 'configure' })
    say({ event: 'init' })
    await waitFor(() => expect(lastAction()?.action).toBe('load'))
    say({ event: 'load' })
    await save({ xml: '<mxfile/>' })
    say({ event: 'export', format: 'svg', data: EXPORTED })

    expect(
      await screen.findByRole('alertdialog', { name: 'Your diagram is not saved' }),
    ).toBeInTheDocument()
    expect(lastAction()).toEqual({
      action: 'status',
      modified: true,
      message: 'Not saved',
      to: ORIGIN,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        kind: 'revised',
        diagram: { ...EXISTING, version: 4 },
      }),
    )
    expect(revise).toHaveBeenCalledTimes(2)
  })

  it('reports a file that holds no diagram, and one that cannot be read', async () => {
    const notDrawio = open({
      files: fakeFiles({
        read: vi.fn<DrawioFiles['read']>(async () => ({ file: '<svg/>', version: 3 })),
      }),
      target: { kind: 'existing', diagram: EXISTING, title: 'x' },
    })
    notDrawio.say({ event: 'init' })
    expect(
      await screen.findByText('This file holds no diagram the editor can open.'),
    ).toBeInTheDocument()
    notDrawio.unmount()

    const read = vi
      .fn<DrawioFiles['read']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ file: STORED, version: 3 })
    const unreadable = open({
      files: fakeFiles({ read }),
      target: { kind: 'existing', diagram: EXISTING, title: 'x' },
    })
    unreadable.say({ event: 'init' })
    expect(await screen.findByText('The diagram could not be opened.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(unreadable.lastAction()?.action).toBe('load'))
  })

  it('ignores an export nobody asked for', () => {
    const { say, actions, files } = open()
    say({ event: 'load' })
    say({ event: 'export', format: 'svg', data: EXPORTED })
    expect(actions()).toEqual([{ action: 'spinner', show: false, to: ORIGIN }])
    expect(files.create).not.toHaveBeenCalled()
  })

  it('asks for one export however often save is pressed while saving', async () => {
    const { say, actions } = open()
    say({ event: 'load' })
    say({ event: 'save', xml: 'not a diagram' })
    say({ event: 'save', xml: 'not a diagram' })
    await waitFor(() =>
      expect(actions().filter((action) => action.action === 'export')).toHaveLength(1),
    )
  })

  it('exports at once when what draw.io saved is not a diagram it can convert', async () => {
    const { say, lastAction } = open()
    say({ event: 'load' })
    say({ event: 'save', xml: 'not a diagram' })
    await waitFor(() => expect(lastAction()?.action).toBe('export'))
  })

  it('ignores a save draw.io sends after the session has closed', async () => {
    const { say, actions, onClose } = open()
    say({ event: 'load' })
    say({ event: 'exit', modified: false })
    expect(onClose).toHaveBeenCalledOnce()
    const before = actions().length

    say({ event: 'save', xml: SAVED })

    expect(actions()).toHaveLength(before)
  })

  it('writes nothing for an export it did not ask for', async () => {
    const { say, actions, files } = open()
    say({ event: 'configure' })

    say({ event: 'export', format: 'svg', data: EXPORTED })

    expect(actions().at(-1)).toMatchObject({ action: 'spinner', show: false })
    expect(files.create).not.toHaveBeenCalled()
    expect(files.revise).not.toHaveBeenCalled()
  })

  it('closes from the prompt that says the diagram did not open', async () => {
    const read = vi.fn<DrawioFiles['read']>().mockRejectedValueOnce(new Error('offline'))
    const { say, onClose } = open({
      files: fakeFiles({ read }),
      target: { kind: 'existing', diagram: EXISTING, title: 'x' },
    })
    say({ event: 'init' })

    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('tells the writer when the editor is diagrams.net’s', () => {
    const { say } = open({ thirdParty: true })
    say({ event: 'load' })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Edited on diagrams.net, which receives this diagram',
    )
  })
})
