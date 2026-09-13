import { act } from 'react'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { THEME_ATTRIBUTE, toast, Toaster } from '@quill/ui'
import { THEME_ID_ATTRIBUTE } from '@quill/ui/theme'

import { DesignPage } from './design-page.tsx'

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  document.documentElement.removeAttribute(THEME_ID_ATTRIBUTE)
  globalThis.localStorage.clear()
  // Toasts live in a store shared across tests (packages/ui/toaster.test.tsx
  // does the same): dismiss whatever a test left showing so it never replays
  // into the next one's freshly rendered `Toaster`.
  act(() => {
    toast.dismiss()
  })
})

describe('DesignPage', () => {
  it('is the shell it is showing, with every region in a landmark', () => {
    render(<DesignPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'The design system' })).toBeInTheDocument()
    expect(screen.getAllByRole('banner')[0]).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('lists every section of the showcase in the tree', () => {
    render(<DesignPage />)

    const tree = screen.getByRole('navigation', { name: 'Showcase documents' })
    for (const label of [
      'foundations',
      'colour',
      'contrast',
      'controls',
      'messaging',
      'signature',
      'layout',
      'reading',
    ]) {
      expect(within(tree).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(tree).getByRole('link', { name: 'foundations' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows every button variant and both busy and unavailable states', () => {
    render(<DesignPage />)

    for (const name of ['Primary', 'Secondary', 'Ghost', 'Danger']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Publishing' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
  })

  it('shows labelled fields, including the described and invalid ones', () => {
    render(<DesignPage />)

    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      'Lowercase letters, numbers, and hyphens.',
    )
    expect(screen.getByLabelText('Share link expiry')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Owner')).toBeDisabled()
  })

  it('shows a callout in every tone', () => {
    render(<DesignPage />)

    expect(screen.getByRole('group', { name: 'Note' })).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Success: Published to the public collection' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /^Warning: This document has drifted/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^Danger: Another author holds/ })).toBeInTheDocument()
  })

  it('shows both forms of every signature variant', () => {
    const { container } = render(<DesignPage />)

    // Header: readout and breadcrumb, side by side.
    expect(container.querySelectorAll('[data-header="readout"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-header="breadcrumb"]').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' }).length).toBeGreaterThan(0)

    // History: the always-visible timeline and the popover trigger.
    expect(screen.getAllByRole('region', { name: 'Revisions' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()

    // Comments: the panel, with its count in the region name.
    expect(screen.getAllByRole('region', { name: 'Comments, 3' }).length).toBeGreaterThan(0)
  })

  it('colours the code sample with the real token classes, once the tokenizer arrives', async () => {
    const { container } = render(<DesignPage />)

    // The grammars are a separate chunk (ADR-030), so the code is readable
    // before they load and coloured after.
    await waitFor(() => {
      expect(container.querySelector('.tok-keyword')).not.toBeNull()
    })
    expect(container.querySelector('.tok-comment')).not.toBeNull()
  })

  it('moves between tabs with the arrow keys', async () => {
    render(<DesignPage />)

    const contentTab = screen.getByRole('tab', { name: 'Content' })
    contentTab.focus()

    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'History', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeDisabled()
  })

  it('opens the dialog, traps focus in it, and closes it on Escape', async () => {
    render(<DesignPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard this draft?' })

    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Discard this draft?' })).not.toBeInTheDocument()
    })
  })

  it('closes the dialog from either footer button', async () => {
    render(<DesignPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await screen.findByRole('dialog', { name: 'Discard this draft?' })
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Discard this draft?' })).not.toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await screen.findByRole('dialog', { name: 'Discard this draft?' })
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Discard this draft?' })).not.toBeInTheDocument()
    })
  })

  it('tells the truth through a toast instead of silently doing nothing when a specimen is pressed', async () => {
    render(
      <>
        <Toaster />
        <DesignPage />
      </>,
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

  it('shows the sample document with a content paragraph, a wide table, and a full image', () => {
    render(<DesignPage />)

    const article = screen.getByRole('article', { name: 'Sample document: regional failover' })
    expect(article).toHaveClass('layout-grid', 'prose')

    const table = within(article).getByRole('table')
    expect(table.closest('.layout-wide')).not.toBeNull()

    const image = within(article).getByRole('img', { name: /system landscape/i })
    expect(image.closest('.layout-full')).not.toBeNull()
  })

  it('draws the three layout widths of the named-line grid', () => {
    const { container } = render(<DesignPage />)

    expect(container.querySelector('.layout-grid > .layout-content')).not.toBeNull()
    expect(container.querySelector('.layout-grid > .layout-wide')).not.toBeNull()
    expect(container.querySelector('.layout-grid > .layout-full')).not.toBeNull()
  })

  it('reports contrast for every pair, in both schemes, from the generator itself', () => {
    render(<DesignPage />)

    const table = screen.getByRole('table', { name: /Generated from this identity/ })
    const row = within(table).getByRole('rowheader', { name: 'foreground on background' })
    const cells = row.parentElement?.querySelectorAll('td') ?? []

    expect(cells[0]?.textContent).toMatch(/^\d+\.\d\d:1$/)
    expect(cells[1]?.textContent).toMatch(/^\d+\.\d\d:1$/)
    expect(cells[3]?.textContent).toBe('pass')
  })
})

describe('DesignPage theme controls', () => {
  it('follows the system scheme and the default identity until either is chosen', () => {
    render(<DesignPage />)

    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    expect(screen.getAllByRole('radio', { name: 'Instrument' })[0]).toBeChecked()
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    expect(document.documentElement.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(false)
  })

  it('sets data-theme when a scheme is chosen, and remembers it', async () => {
    render(<DesignPage />)

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    })
    expect(globalThis.localStorage.getItem('theme-preference')).toBe('dark')

    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))

    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
    })
  })

  it('returns to following the system scheme', async () => {
    render(<DesignPage />)

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    })

    await userEvent.click(screen.getByRole('radio', { name: 'System' }))

    await waitFor(() => {
      expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    })
  })

  it('starts from the remembered scheme', () => {
    globalThis.localStorage.setItem('theme-preference', 'dark')

    render(<DesignPage />)

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('sets data-theme-id when another identity is chosen', async () => {
    render(<DesignPage />)

    await userEvent.click(screen.getAllByRole('radio', { name: 'Press' })[0] as HTMLElement)

    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ID_ATTRIBUTE)).toBe('press')
    })
  })

  it('changes the signature variants with the identity', async () => {
    render(<DesignPage />)

    expect(screen.getByRole('navigation', { name: 'Showcase documents' })).toHaveAttribute(
      'data-navigation',
      'tree',
    )

    await userEvent.click(screen.getAllByRole('radio', { name: 'Atelier' })[0] as HTMLElement)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Showcase documents' })).toHaveAttribute(
        'data-navigation',
        'tabs',
      )
    })
    // Atelier asks for cards rather than hairlines, everywhere at once.
    const shell = document.querySelector('.document-shell')
    expect(shell).toHaveAttribute('data-rules', 'cards')
  })

  it('drops back to the default identity without writing its name', async () => {
    render(<DesignPage />)

    await userEvent.click(screen.getAllByRole('radio', { name: 'Press' })[0] as HTMLElement)
    await waitFor(() => {
      expect(document.documentElement.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(true)
    })

    await userEvent.click(screen.getAllByRole('radio', { name: 'Instrument' })[0] as HTMLElement)

    await waitFor(() => {
      expect(document.documentElement.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(false)
    })
  })

  it('moves between scheme options with the arrow keys', async () => {
    render(<DesignPage />)

    screen.getByRole('radio', { name: 'System' }).focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })
})
