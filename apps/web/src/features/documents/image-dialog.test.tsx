import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ImageDialog } from './image-dialog.tsx'
import type { ImageRequest } from './image-dialog.tsx'

describe('the image dialog asked for a drawing', () => {
  it('asks for an SVG file only, with no address to use instead', async () => {
    const onSubmit = vi.fn<(request: ImageRequest) => void>()
    render(
      <ImageDialog
        open
        purpose="drawing"
        maxBytes={1024}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Insert an SVG drawing' })
    const file = screen.getByLabelText('Drawing file')
    expect(file).toHaveAttribute('accept', 'image/svg+xml')
    expect(screen.queryByLabelText('Image address')).toBeNull()
    await expectNoAccessibilityViolations(dialog)

    const user = userEvent.setup()
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'map.svg', {
      type: 'image/svg+xml',
    })
    await user.upload(file, svg)
    await user.type(screen.getByLabelText(/Alternative text/), 'The sync map')
    await user.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'upload', file: svg, alt: 'The sync map' })
  })

  it('offers an address as well when asked for a picture', () => {
    render(<ImageDialog open maxBytes={1024} onOpenChange={() => {}} onSubmit={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Insert an image' })).toBeVisible()
    expect(screen.getByLabelText('Image address')).toBeVisible()
  })
})
