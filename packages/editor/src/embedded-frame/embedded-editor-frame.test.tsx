import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { EmbeddedEditorFrame } from './embedded-editor-frame.tsx'

/** The shell an external editor runs in: a modal dialog with a bar over the editor's frame. */

function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '')
}

function closeDialog(this: HTMLDialogElement) {
  this.removeAttribute('open')
}

beforeAll(() => {
  // jsdom has no modal dialogs; the shims do what the browser's do, minus the top layer.
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = closeDialog
})

function open(children?: React.ReactNode) {
  const onCloseRequest = vi.fn<() => void>()
  const view = render(
    <EmbeddedEditorFrame
      title="Draw.io diagram"
      src="https://editor.example.com/"
      sandbox="allow-scripts"
      frameRef={null}
      onCloseRequest={onCloseRequest}
    >
      {children}
    </EmbeddedEditorFrame>,
  )
  return { ...view, onCloseRequest }
}

describe('the embedded editor frame', () => {
  it('names itself, holds the editor’s frame, and stops the page scrolling behind it', () => {
    const { unmount } = open()

    expect(screen.getByRole('dialog', { name: 'Draw.io diagram' })).toHaveAttribute('open')
    expect(screen.getByTitle('Draw.io diagram')).toHaveAttribute(
      'src',
      'https://editor.example.com/',
    )
    expect(document.documentElement).toHaveClass('lightbox-open')

    unmount()
    expect(document.documentElement).not.toHaveClass('lightbox-open')
  })

  it('draws nothing over the frame unless it is given something to ask', () => {
    const { container } = open()
    expect(container.querySelector('.absolute')).toBeNull()

    const asked = open(<p>Close without saving?</p>)
    expect(asked.getByText('Close without saving?')).toBeInTheDocument()
  })

  it('turns Escape and the close button into a request, never a close', async () => {
    const { onCloseRequest } = open()

    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Close Draw.io diagram' }))

    expect(onCloseRequest).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
  })
})
