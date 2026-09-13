import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { AttachmentsPanel, fileSize, inUse, typeLabel } from './attachments-panel.tsx'

/**
 * The other half of attachments: the list, and the one refusal that is a rule
 * rather than a fault.
 */

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-1',
    documentId: 'doc-1',
    url: '/api/attachments/attachment-1',
    filename: 'sequence-diagram.png',
    contentType: 'image/png',
    size: 204_800,
    sha256: 'a'.repeat(64),
    uploadedBy: 'user-1',
    createdAt: '2026-02-03T00:00:00.000Z',
    ...overrides,
  }
}

function open(routes: FakeRoutes, canEdit = true) {
  const Wrapper = createHookWrapper(routes)
  return render(
    <Wrapper>
      <AttachmentsPanel documentId="doc-1" open onOpenChange={() => {}} canEdit={canEdit} />
    </Wrapper>,
  )
}

const listing = (...rows: readonly ReturnType<typeof attachment>[]): FakeRoutes => ({
  'GET /api/documents/{id}/attachments': () => jsonResponse(200, { attachments: rows }),
})

describe('the attachments panel', () => {
  it('lists what the document carries, with its type and size', async () => {
    open(
      listing(
        attachment(),
        attachment({
          id: 'attachment-2',
          filename: 'runbook.pdf',
          contentType: 'application/pdf',
          size: 1_048_576,
        }),
      ),
    )

    const table = await screen.findByRole('table')
    expect(within(table).getByText('sequence-diagram.png')).toBeInTheDocument()
    expect(within(table).getByText(/PNG · 200 KB/)).toBeInTheDocument()
    expect(within(table).getByText('runbook.pdf')).toBeInTheDocument()
    expect(within(table).getByText(/PDF · 1.0 MB/)).toBeInTheDocument()
  })

  it('says so, and says what to do, when the document carries nothing', async () => {
    open(listing())

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('offers no delete to somebody who may only read', async () => {
    open(listing(attachment()), false)

    await screen.findByRole('table')
    expect(
      screen.queryByRole('button', { name: /Delete sequence-diagram/ }),
    ).not.toBeInTheDocument()
  })

  it('deletes one, after asking', async () => {
    let deleted: string | undefined
    open({
      ...listing(attachment()),
      'DELETE /api/attachments/{id}': (_request, params) => {
        deleted = params['id']
        return new Response(null, { status: 204 })
      },
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete sequence-diagram.png' }),
    )
    const confirm = await screen.findByRole('dialog', { name: /Delete “sequence-diagram.png”/ })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleted).toBe('attachment-1')
    })
  })

  it('shows the refusal in place, with no Delete button, when a document still shows it', async () => {
    open({
      ...listing(attachment()),
      'DELETE /api/attachments/{id}': () =>
        errorResponse(409, 'attachment_in_use', 'A published document still shows this file.', {
          documents: ['doc-2'],
          hidden: 0,
        }),
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete sequence-diagram.png' }),
    )
    const confirm = await screen.findByRole('dialog', { name: /Delete “sequence-diagram.png”/ })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    expect(await within(confirm).findByText(/still shows this file/)).toBeInTheDocument()
    expect(within(confirm).getByText(/1 document shows it/)).toBeInTheDocument()
    expect(within(confirm).getByText(/Take the picture out of the document/)).toBeInTheDocument()
    // A button certain to be refused is not offered (`docs/design/feedback.md`).
    expect(within(confirm).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = open(listing(attachment()))
    await screen.findByRole('table')

    await expectNoAccessibilityViolations(container)
  })
})

describe('inUse', () => {
  it('recognises only the refusal it is about', () => {
    expect(inUse(undefined)).toBeUndefined()
    expect(inUse(new Error('something else'))).toBeUndefined()
  })

  it('counts what the caller can see and what they cannot, separately', async () => {
    const { ApiError } = await import('../../lib/api/errors.ts')
    const obstacle = (details: unknown) =>
      inUse(new ApiError(409, { code: 'attachment_in_use', message: 'in use', details }))

    expect(obstacle({ documents: ['a', 'b'], hidden: 0 })?.body).toBeDefined()
    // The shapes are read defensively: a detail block from another release
    // reads as nothing rather than throwing.
    expect(obstacle(undefined)).toBeDefined()
    expect(obstacle('not an object')).toBeDefined()
    expect(obstacle({})).toBeDefined()
  })
})

describe('the way sizes and types read', () => {
  it('uses the unit a person would say it in', () => {
    expect(fileSize(512)).toBe('512 bytes')
    expect(fileSize(2048)).toBe('2 KB')
    expect(fileSize(3_670_016)).toBe('3.5 MB')
  })

  it('names a type by its subtype', () => {
    expect(typeLabel('image/png')).toBe('PNG')
    expect(typeLabel('application/pdf')).toBe('PDF')
    expect(typeLabel('nonsense')).toBe('NONSENSE')
  })
})
