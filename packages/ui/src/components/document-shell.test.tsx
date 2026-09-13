import { render, screen } from '@testing-library/react'
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
