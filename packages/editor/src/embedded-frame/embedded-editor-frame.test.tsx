import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Type } from '@sinclair/typebox'
import { useRef, type ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { EmbeddedEditorFrame } from './embedded-editor-frame.tsx'
import { jsonStringCodec } from './frame-channel.ts'
import { useFrameChannel } from './use-frame-channel.ts'

const ORIGIN = 'https://editor.example.com'

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

const Ping = Type.Object({ event: Type.Literal('ping') })

/** A frame with no editor in it yet: the ref is never attached. */
function Detached({
  onMessage,
  onSend,
}: {
  readonly onMessage: () => void
  readonly onSend: (send: (message: never) => boolean) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const send = useFrameChannel({
    frameRef,
    origin: ORIGIN,
    inbound: Ping,
    codec: jsonStringCodec<never>(),
    timeoutMs: 60_000,
    onMessage,
    onSilent: () => {},
  })
  onSend(send)
  return null
}

describe('EmbeddedEditorFrame', () => {
  it('is a named modal over the page, with nothing over the frame until asked, and passes axe', async () => {
    const onCloseRequest = vi.fn<() => void>()
    const { unmount } = render(
      <EmbeddedEditorFrame
        title="Some editor"
        src={`${ORIGIN}/`}
        sandbox="allow-scripts"
        frameRef={{ current: null }}
        onCloseRequest={onCloseRequest}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Some editor' })
    expect(dialog).toHaveAttribute('open')
    expect(document.documentElement).toHaveClass('lightbox-open')
    expect(screen.getByTitle('Some editor')).not.toHaveAttribute('allow')
    expect(screen.getByRole('status')).toHaveTextContent('')
    await expectNoAccessibilityViolations(document.body, { iframes: false })

    screen.getByRole('button', { name: 'Close Some editor' }).click()
    expect(onCloseRequest).toHaveBeenCalledOnce()
    unmount()
    expect(document.documentElement).not.toHaveClass('lightbox-open')
  })
})

describe('useFrameChannel', () => {
  it('hears nothing while there is no frame to hear from', () => {
    const onMessage = vi.fn<() => void>()
    let send: ((message: never) => boolean) | undefined
    const { unmount } = render(
      <Detached
        onMessage={onMessage}
        onSend={(given) => {
          send = given
        }}
      />,
    )
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: '{"event":"ping"}', origin: ORIGIN, source: window }),
      )
    })
    expect(onMessage).not.toHaveBeenCalled()
    unmount()
    expect(send?.(undefined as never)).toBe(false)
  })
})

function openFrame(children?: ReactNode) {
  const onCloseRequest = vi.fn<() => void>()
  const view = render(
    <EmbeddedEditorFrame
      title="Draw.io diagram"
      src={`${ORIGIN}/`}
      sandbox="allow-scripts"
      frameRef={{ current: null }}
      onCloseRequest={onCloseRequest}
    >
      {children}
    </EmbeddedEditorFrame>,
  )
  return { ...view, onCloseRequest }
}

describe('the embedded editor frame, as a modal', () => {
  it('names itself, holds the editor’s frame, and stops the page scrolling behind it', () => {
    const { unmount } = openFrame()

    expect(screen.getByRole('dialog', { name: 'Draw.io diagram' })).toHaveAttribute('open')
    expect(screen.getByTitle('Draw.io diagram')).toHaveAttribute('src', `${ORIGIN}/`)
    expect(document.documentElement).toHaveClass('lightbox-open')

    unmount()
    expect(document.documentElement).not.toHaveClass('lightbox-open')
  })

  it('draws what it is given to ask over the frame', () => {
    const asked = openFrame(<p>Close without saving?</p>)
    expect(asked.getByText('Close without saving?')).toBeInTheDocument()
  })

  it('turns Escape and the close button into a request, never a close', async () => {
    const { onCloseRequest } = openFrame()

    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Close Draw.io diagram' }))

    expect(onCloseRequest).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
  })
})
