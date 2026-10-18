import { act } from 'react'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { toast, Toaster, TooltipProvider } from '@quill/ui'

import {
  ButtonSpecimens,
  CalloutSpecimens,
  InputSpecimens,
  NavigationSpecimens,
} from './component-specimens.tsx'

/*
 * Each specimen is rendered on its own rather than inside the whole showcase:
 * the page is thousands of elements, and every role query and every click on
 * it walks all of them, which made one file of these take minutes under
 * coverage. What the page composes is `design-page.test.tsx`'s to check.
 */

afterEach(() => {
  // Toasts live in a store shared across tests (packages/ui/toaster.test.tsx
  // does the same): dismiss whatever a test left showing so it never replays
  // into the next one's freshly rendered `Toaster`.
  act(() => {
    toast.dismiss()
  })
})

const renderNavigation = () =>
  render(
    <TooltipProvider>
      <NavigationSpecimens />
    </TooltipProvider>,
  )

const discardDialog = () => screen.queryByRole('dialog', { name: 'Discard this draft?' })

describe('the button specimens', () => {
  it('show every button variant and both busy and unavailable states', () => {
    render(
      <TooltipProvider>
        <ButtonSpecimens />
      </TooltipProvider>,
    )

    for (const name of ['Primary', 'Secondary', 'Ghost', 'Danger']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Publishing' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
  })

  it('tell the truth through a toast instead of silently doing nothing when pressed', async () => {
    render(
      <TooltipProvider>
        <Toaster />
        <ButtonSpecimens />
      </TooltipProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Restore revision' }))

    // A generous wait: the toast host is a chunk of its own (`Toaster` loads
    // it as soon as it mounts), so the very first toast in a test file waits
    // for that import as well as for the click.
    expect(await screen.findByText('Specimen', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(
      screen.getByText('This shows the button; restoring a revision happens from the editor.'),
    ).toBeInTheDocument()
  })
})

describe('the field specimens', () => {
  it('show labelled fields, including the described and invalid ones', () => {
    render(<InputSpecimens />)

    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      'Lowercase letters, numbers, and hyphens.',
    )
    expect(screen.getByLabelText('Share link expiry')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Owner')).toBeDisabled()
  })
})

describe('the callout specimens', () => {
  it('show a callout in every tone', () => {
    render(<CalloutSpecimens />)

    expect(screen.getByRole('group', { name: 'Note' })).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Success: Published to the public collection' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /^Warning: This document has drifted/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^Danger: Another author holds/ })).toBeInTheDocument()
  })
})

describe('the navigation specimens', () => {
  it('move between tabs with the arrow keys', async () => {
    renderNavigation()

    screen.getByRole('tab', { name: 'Content' }).focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'History', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeDisabled()
  })

  it('open the dialog, trap focus in it, and close it on Escape', async () => {
    renderNavigation()

    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard this draft?' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(discardDialog()).not.toBeInTheDocument()
    })
  })

  it('close the dialog from either footer button', async () => {
    renderNavigation()

    for (const footerButton of ['Keep editing', 'Discard']) {
      await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
      await screen.findByRole('dialog', { name: 'Discard this draft?' })
      await userEvent.click(screen.getByRole('button', { name: footerButton }))
      await waitFor(() => {
        expect(discardDialog()).not.toBeInTheDocument()
      })
    }
  })
})
