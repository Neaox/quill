import { act } from 'react'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { THEME_ATTRIBUTE, toast } from '@quill/ui'
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

/**
 * The page's own header, found without a role query: the showcase is thousands
 * of elements, and a role query walks every one of them.
 */
function pageHeader() {
  const header = document.querySelector('header')
  if (header === null) throw new Error('The page has no header')
  return within(header)
}

const colourSchemeToggle = () => pageHeader().getByRole('button', { name: /^Colour scheme:/u })

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

  it('draws the three layout widths of the named-line grid', () => {
    const { container } = render(<DesignPage />)

    expect(container.querySelector('.layout-grid > .layout-content')).not.toBeNull()
    expect(container.querySelector('.layout-grid > .layout-wide')).not.toBeNull()
    expect(container.querySelector('.layout-grid > .layout-full')).not.toBeNull()
  })

  it('composes every specimen into the page', () => {
    // Each specimen has tests of its own; this says the page shows them.
    const { container } = render(<DesignPage />)

    // By id and by text rather than by role: a role query walks the whole showcase.
    for (const id of ['foundations', 'colour', 'contrast', 'controls', 'messaging', 'signature']) {
      expect(container.querySelector(`main section#${id}`)).not.toBeNull()
    }
    expect(screen.getByText('Discard draft')).toBeInTheDocument()
    expect(screen.getByText('foreground on background')).toBeInTheDocument()
    expect(container.querySelector('main [data-header="readout"]')).not.toBeNull()
    expect(
      container.querySelector('main article[aria-label="Sample document: regional failover"]'),
    ).not.toBeNull()
  })
})

describe('DesignPage theme controls', () => {
  it('follows the system scheme and the default identity until either is chosen', () => {
    render(<DesignPage />)

    expect(pageHeader().getByRole('button', { name: 'Colour scheme: System' })).toBeInTheDocument()
    expect(pageHeader().getByRole('radio', { name: 'Instrument' })).toBeChecked()
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    expect(document.documentElement.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(false)
  })

  it('sets data-theme when a scheme is chosen, and remembers it', async () => {
    render(<DesignPage />)

    await userEvent.click(colourSchemeToggle())
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
    })

    await userEvent.click(colourSchemeToggle())
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    })
    expect(globalThis.localStorage.getItem('theme-preference')).toBe('dark')
  })

  it('returns to following the system scheme', async () => {
    render(<DesignPage />)

    await userEvent.click(colourSchemeToggle())
    await userEvent.click(colourSchemeToggle())
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    })

    await userEvent.click(colourSchemeToggle())

    await waitFor(() => {
      expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    })
  })

  it('starts from the remembered scheme', () => {
    globalThis.localStorage.setItem('theme-preference', 'dark')

    render(<DesignPage />)

    expect(pageHeader().getByRole('button', { name: 'Colour scheme: Dark' })).toBeInTheDocument()
  })

  it('sets data-theme-id when another identity is chosen', async () => {
    render(<DesignPage />)

    await userEvent.click(pageHeader().getByRole('radio', { name: 'Editorial' }))

    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ID_ATTRIBUTE)).toBe('editorial')
    })
  })

  it('changes the signature variants with the identity', async () => {
    render(<DesignPage />)

    expect(screen.getByRole('navigation', { name: 'Showcase documents' })).toHaveAttribute(
      'data-navigation',
      'tree',
    )

    await userEvent.click(pageHeader().getByRole('radio', { name: 'Atelier' }))

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

    await userEvent.click(pageHeader().getByRole('radio', { name: 'Grid' }))
    await waitFor(() => {
      expect(document.documentElement.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(true)
    })

    await userEvent.click(pageHeader().getByRole('radio', { name: 'Instrument' }))

    await waitFor(() => {
      expect(document.documentElement.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(false)
    })
  })
})
