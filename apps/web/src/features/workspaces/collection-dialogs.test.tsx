import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { DeleteCollectionDialog } from './collection-dialogs.tsx'

function open(documentCount: number | undefined, routes: FakeRoutes = {}) {
  const Wrapper = createHookWrapper(routes)
  return render(
    <Wrapper>
      <DeleteCollectionDialog
        open
        onOpenChange={() => {}}
        workspaceId="ws-1"
        collectionId="col-1"
        name="Guides"
        documentCount={documentCount}
      />
    </Wrapper>,
  )
}

describe('DeleteCollectionDialog', () => {
  it('says the collection is empty only when that is known', () => {
    open(0)

    expect(screen.getByText(/This collection is empty, so nothing is lost/u)).toBeInTheDocument()
  })

  it('does not claim a collection is empty when the navigation has not loaded what is in it', () => {
    // The tree loads a level at a time, so for a collection it has not opened it knows nothing.
    open(undefined)

    expect(screen.queryByText(/This collection is empty/u)).not.toBeInTheDocument()
    expect(screen.getByText(/asked to move them first/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('turns the server’s refusal into the reason and the way out', async () => {
    open(undefined, {
      'DELETE /api/collections/{id}': () =>
        errorResponse(409, 'collection_not_empty', 'Collection is not empty', { documents: 2 }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/It still holds 2 documents/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move documents first' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
