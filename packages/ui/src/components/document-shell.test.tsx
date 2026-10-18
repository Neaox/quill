import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ThemeVariantsProvider } from '../theme/theme-variants.tsx'
import { type DocumentStatus } from './document-header.tsx'
import { DocumentShell } from './document-shell.tsx'
import { linkHref, type LinkComponent } from '../lib/link.tsx'
import { type IconRailItem } from './icon-rail.tsx'
import { OutlineIcon, SearchIcon } from './icons.tsx'
import { Tree, type TreeSection } from './tree.tsx'

const STATUS: DocumentStatus = {
  path: [{ label: 'acme', link: { to: '#acme' } }, { label: 'authentication' }],
  version: 'v12',
  updated: '2026-08-15',
  owner: 'platform',
  state: 'published',
}

const RAIL: readonly IconRailItem[] = [
  { id: 'outline', label: 'Documents', icon: <OutlineIcon />, link: { to: '#documents' } },
  { id: 'search', label: 'Search', icon: <SearchIcon />, link: { to: '#search' } },
]

const SECTIONS: readonly TreeSection[] = [
  {
    id: 'engineering',
    label: 'engineering',
    nodes: [{ id: 'authentication', label: 'authentication', link: { to: '#authentication' } }],
  },
]

function renderShell(props: Partial<Parameters<typeof DocumentShell>[0]> = {}) {
  return render(
    <DocumentShell
      status={STATUS}
      railItems={RAIL}
      railCurrentId="outline"
      navigation={<Tree label="Documents" sections={SECTIONS} currentId="authentication" />}
      {...props}
    >
      <h1>Authentication architecture</h1>
    </DocumentShell>,
  )
}

/** A `linkComponent` that resolves the target itself, so a test can tell it was used. */
const StubLink: LinkComponent = ({ to, params, search, hash, children, ...rest }) => (
  <a href={linkHref({ to, params, search, hash })} {...rest} data-stub-link="true">
    {children}
  </a>
)

describe('DocumentShell', () => {
  it('puts every region in a landmark', async () => {
    const { container } = renderShell({ aside: <p>Revisions</p> })

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('starts with a skip link that points at the document', async () => {
    renderShell()

    await userEvent.tab()

    const skip = screen.getByRole('link', { name: 'Skip to document' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#document')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'document')
  })

  it('omits the complementary column when there is nothing for it', () => {
    renderShell()

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('takes the rule treatment from the identity in scope', () => {
    const { container } = render(
      <ThemeVariantsProvider themeId="atelier">
        <DocumentShell
          status={STATUS}
          railItems={RAIL}
          navigation={<Tree label="Documents" sections={SECTIONS} />}
        >
          <h1>Authentication architecture</h1>
        </DocumentShell>
      </ThemeVariantsProvider>,
    )

    expect(container.querySelector('.document-shell')).toHaveAttribute('data-rules', 'cards')
    expect(screen.getByRole('banner')).toHaveAttribute('data-header', 'breadcrumb')
  })

  it('lets a preview override the rule treatment and the header', () => {
    const { container } = renderShell({ rules: 'double', headerVariant: 'breadcrumb' })

    expect(container.querySelector('.document-shell')).toHaveAttribute('data-rules', 'double')
    expect(screen.getByRole('banner')).toHaveAttribute('data-header', 'breadcrumb')
  })

  /*
   * Regression, review 2026-09-13 H4: the complementary column was rendered
   * whenever a document id was in the address, so the editor — and every
   * notice shown in the shell's main area — was framed by an empty bordered
   * strip the width of the revisions panel.
   */
  it('renders the complementary column only when something asks for one', () => {
    const { container: withoutAside } = renderShell()
    expect(withoutAside.querySelector('aside')).toBeNull()

    const { container: withAside } = renderShell({ aside: <p>Revisions</p> })
    expect(withAside.querySelector('aside')).not.toBeNull()

    // A feature that fills the column by portal hands a ref instead: the
    // element exists so there is something to render into, and `:empty` in
    // `components.css` collapses it until something has been.
    const { container: withRef } = renderShell({ asideRef: () => {} })
    const column = withRef.querySelector('aside')
    expect(column).not.toBeNull()
    expect(column?.childElementCount).toBe(0)
  })

  it('renders every link it owns — the rail and the header trail — through one `linkComponent`', () => {
    renderShell({
      headerVariant: 'breadcrumb',
      linkComponent: StubLink,
    })

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'data-stub-link',
      'true',
    )
    expect(screen.getByRole('link', { name: 'acme' })).toHaveAttribute('data-stub-link', 'true')
  })

  it('carries the document controls, the mark, and a rail footer', () => {
    renderShell({
      mark: <span>AC</span>,
      actions: <button type="button">Edit</button>,
      railFooter: <span>MR</span>,
      skipLabel: 'Skip to the runbook',
    })

    expect(screen.getByText('AC')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByText('MR')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skip to the runbook' })).toBeInTheDocument()
  })
})

/*
 * On a phone the tree is behind a button, not a band above the document
 * (2026-10-17). The CSS hides the button at the medium breakpoint and up and
 * draws the open tree as a sheet under the header; jsdom lays nothing out, so
 * these test the behaviour every width shares.
 */
/** Answers the medium-breakpoint query as a phone would; returns the undo. */
function onAPhone(): () => void {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('48rem'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
  return () => {
    Reflect.deleteProperty(globalThis, 'matchMedia')
  }
}

describe('DocumentShell on a narrow screen', () => {
  it('keeps the tree behind a disclosure, and opens it onto the document being read', async () => {
    const { container } = renderShell()

    const toggle = screen.getByRole('button', { name: 'Browse documents' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('[data-shell-nav]')).toHaveAttribute('data-state', 'closed')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('[data-shell-nav]')).toHaveAttribute('data-state', 'open')
    expect(screen.getByRole('link', { name: 'authentication' })).toHaveFocus()
    await expectNoAccessibilityViolations(container)
  })

  it('closes on Escape, giving focus back to the button', async () => {
    renderShell()
    const toggle = screen.getByRole('button', { name: 'Browse documents' })

    await userEvent.click(toggle)
    await userEvent.keyboard('{Escape}')

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('closes on a second press of its button, or on the sheet’s own close button', async () => {
    renderShell()
    const toggle = screen.getByRole('button', { name: 'Browse documents' })

    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'Close documents' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('stays open for other keys, and for an Escape something inside has already handled', async () => {
    renderShell()
    const toggle = screen.getByRole('button', { name: 'Browse documents' })
    await userEvent.click(toggle)
    const link = screen.getByRole('link', { name: 'authentication' })

    await userEvent.keyboard('{ArrowDown}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    link.addEventListener('keydown', (event) => {
      event.preventDefault()
    })
    await userEvent.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens onto its first control when nothing in it is current', async () => {
    renderShell({
      railCurrentId: undefined,
      navigation: <Tree label="Documents" sections={SECTIONS} />,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Browse documents' }))

    expect(screen.getByRole('button', { name: 'Close documents' })).toHaveFocus()
  })

  it('closes when a document in it is chosen', async () => {
    renderShell()
    const toggle = screen.getByRole('button', { name: 'Browse documents' })

    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('link', { name: 'authentication' }))

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('has one way in on a phone: the rail’s sections move into the sheet, above the tree', async () => {
    const restore = onAPhone()
    try {
      const { container } = renderShell()

      // No second band of chrome: the rail is not drawn on a phone; its
      // sections are only in the sheet.
      const [only] = screen.getAllByRole('navigation', { name: 'Workspace' })
      expect(screen.getAllByRole('navigation', { name: 'Workspace' })).toHaveLength(1)
      expect(only?.closest('[data-shell-nav]')).not.toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Browse documents' }))
      const sheet = screen.getByRole('region', { name: 'Browse' })
      const sections = within(sheet).getByRole('navigation', { name: 'Workspace' })
      expect(within(sections).getByRole('link', { name: 'Documents' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(within(sheet).getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
      // Opened onto the document being read, not onto the section it is in.
      expect(within(sheet).getByRole('link', { name: 'authentication' })).toHaveFocus()
      await expectNoAccessibilityViolations(container)
    } finally {
      restore()
    }
  })

  it('keeps the rail where it is on a wider screen', () => {
    renderShell()

    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument()
  })

  it('takes the page behind out of reach while the sheet covers it, on a narrow screen only', async () => {
    const restore = onAPhone()
    try {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Browse documents' }))
      expect(screen.getByRole('main', { hidden: true })).toHaveAttribute('inert')
    } finally {
      restore()
    }
  })
})
