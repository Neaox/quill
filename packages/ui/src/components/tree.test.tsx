import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ThemeVariantsProvider } from '../theme/theme-variants.tsx'
import { Tree, type TreeNode, type TreeSection } from './tree.tsx'

const SECTIONS: readonly TreeSection[] = [
  {
    id: 'engineering',
    label: 'engineering',
    nodes: [
      {
        id: 'architecture',
        label: 'architecture',
        link: { to: '#architecture' },
        children: [
          { id: 'system-overview', label: 'system-overview', link: { to: '#system-overview' } },
          { id: 'authentication', label: 'authentication', link: { to: '#authentication' } },
        ],
      },
      { id: 'runbooks', label: 'runbooks', link: { to: '#runbooks' } },
    ],
  },
  {
    id: 'product',
    label: 'product',
    nodes: [{ id: 'specifications', label: 'specifications', link: { to: '#specifications' } }],
  },
]

function StubLink({
  to,
  className,
  children,
}: {
  readonly to: string
  readonly className: string
  readonly children: ReactNode
}) {
  return (
    <a href={to} className={className} data-stub-link="true">
      {children}
    </a>
  )
}

describe('Tree', () => {
  it('is a labelled navigation landmark of nested lists', async () => {
    const { container } = render(
      <Tree label="Documents" sections={SECTIONS} currentId="authentication" />,
    )

    const nav = screen.getByRole('navigation', { name: 'Documents' })
    expect(within(nav).getAllByRole('list')).toHaveLength(3)
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
    await expectNoAccessibilityViolations(container)
  })

  it('marks only the document being read as the current page', () => {
    render(<Tree label="Documents" sections={SECTIONS} currentId="authentication" />)

    expect(screen.getByRole('link', { name: 'authentication' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const name of ['architecture', 'runbooks', 'system-overview', 'specifications']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('aria-current')
    }
  })

  it('marks nothing when no document is open', () => {
    render(<Tree label="Documents" sections={SECTIONS} />)

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
  })

  it('indents a nested branch and leaves the top level flush', () => {
    const { container } = render(<Tree label="Documents" sections={SECTIONS} />)

    expect(container.querySelectorAll('.tree-branch')).toHaveLength(1)
  })

  it('reaches every document from the keyboard, in reading order', async () => {
    render(<Tree label="Documents" sections={SECTIONS} />)

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'architecture' })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'system-overview' })).toHaveFocus()
  })

  it('takes the navigation variant from the identity in scope', () => {
    render(
      <ThemeVariantsProvider themeId="atelier">
        <Tree label="Documents" sections={SECTIONS} />
      </ThemeVariantsProvider>,
    )

    expect(screen.getByRole('navigation', { name: 'Documents' })).toHaveAttribute(
      'data-navigation',
      'tabs',
    )
  })

  it('lets a preview ask for a variant the page is not in', () => {
    render(<Tree label="Documents" sections={SECTIONS} variant="tabs" />)

    expect(screen.getByRole('navigation', { name: 'Documents' })).toHaveAttribute(
      'data-navigation',
      'tabs',
    )
  })

  /*
   * TODO(ADR-028): Atelier's `tabs` variant — coloured collection tabs above a
   * single branch — is not built. Until it is, `tabs` renders the tree, which
   * is correct and complete but not Atelier's signature. This test is the
   * marker: when the variant is built, it should assert a tab list instead,
   * and the note in `TreeProps` should go with it.
   */
  it('renders the tree for the tabs variant, which is not built yet', () => {
    render(<Tree label="Documents" sections={SECTIONS} variant="tabs" />)

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'architecture' })).toBeInTheDocument()
  })

  it('shows a "more actions" disclosure only for a node with actions, and runs the action chosen', async () => {
    const onSelect = vi.fn<() => void>()
    render(
      <Tree
        label="Documents"
        sections={SECTIONS}
        nodeActions={(node: TreeNode) =>
          node.id === 'runbooks' ? [{ label: 'Move to…', onSelect }] : []
        }
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'More actions for architecture' }),
    ).not.toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: 'More actions for runbooks' })
    // A real `<button>`, not `<summary role="button">`: it gets the design
    // system's actual cursor and hover treatment rather than a lookalike.
    expect(trigger.tagName).toBe('BUTTON')

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))

    expect(onSelect).toHaveBeenCalledOnce()
    // Choosing an action closes the menu.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the "more actions" menu on Escape, and on a press outside it', async () => {
    render(
      <Tree
        label="Documents"
        sections={SECTIONS}
        nodeActions={(node: TreeNode) =>
          node.id === 'runbooks' ? [{ label: 'Move to…', onSelect: vi.fn<() => void>() }] : []
        }
      />,
    )

    const trigger = screen.getByRole('button', { name: 'More actions for runbooks' })

    await userEvent.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await userEvent.click(trigger)
    await screen.findByRole('menu')
    await userEvent.click(screen.getByRole('link', { name: 'architecture' }))
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('keeps the "more actions" menu open for keys that are not Escape', async () => {
    render(
      <Tree
        label="Documents"
        sections={SECTIONS}
        nodeActions={(node: TreeNode) =>
          node.id === 'runbooks' ? [{ label: 'Move to…', onSelect: vi.fn<() => void>() }] : []
        }
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'More actions for runbooks' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('renders a node with no destination as a link to nowhere rather than crashing', () => {
    render(
      <Tree
        label="Documents"
        sections={[{ id: 'loose', label: 'loose', nodes: [{ id: 'orphan', label: 'orphan' }] }]}
      />,
    )

    // An anchor with an empty destination has no link role, so it is found by
    // its text: what matters is that it renders, as an anchor, without a crash.
    const anchor = screen.getByText('orphan').closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href') ?? '').toBe('')
  })

  it('renders links through a supplied `linkComponent` instead of a plain anchor', () => {
    render(<Tree label="Documents" sections={SECTIONS} linkComponent={StubLink} />)

    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('data-stub-link', 'true')
    }
  })

  it('offers a section-level action, always in the DOM so keyboard reaches it before hover reveals it', async () => {
    const onSelect = vi.fn<() => void>()
    render(
      <Tree
        label="Documents"
        sections={[{ ...SECTIONS[0]!, action: { label: 'New document in engineering', onSelect } }]}
      />,
    )

    const action = screen.getByRole('button', { name: 'New document in engineering' })
    expect(action).toBeInTheDocument()

    await userEvent.click(action)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('gives a section its own "more actions" menu, named after the section', async () => {
    const onRename = vi.fn<() => void>()
    render(
      <Tree
        label="Documents"
        sections={[
          { ...SECTIONS[0]!, actions: [{ label: 'Rename…', onSelect: onRename }] },
          SECTIONS[1]!,
        ]}
      />,
    )

    // The section with no actions gets no disclosure at all.
    expect(
      screen.queryByRole('button', { name: 'More actions for product' }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'More actions for engineering' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    expect(onRename).toHaveBeenCalledOnce()
  })

  it('offers no section menu in selectable mode, where a section is a place rather than a thing', () => {
    render(
      <Tree
        label="Choose a destination"
        sections={[
          { ...SECTIONS[0]!, actions: [{ label: 'Rename…', onSelect: vi.fn<() => void>() }] },
        ]}
        selectable
      />,
    )

    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
  })

  describe('selectable mode', () => {
    const PICKER_SECTIONS: readonly TreeSection[] = [
      {
        id: 'guides',
        label: 'Guides',
        nodes: [
          { id: 'top:guides', label: 'Top level', current: true },
          {
            id: 'doc:onboarding',
            label: 'Onboarding',
            disabled: true,
            disabledReason: 'Would move the document into itself',
          },
        ],
      },
    ]

    it('renders every node as a button rather than a link', () => {
      render(<Tree label="Choose a destination" sections={PICKER_SECTIONS} selectable />)

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Top level/ })).toBeInTheDocument()
    })

    it('marks the chosen destination with aria-pressed and reports it on select', async () => {
      function Picker() {
        const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
        return (
          <Tree
            label="Choose a destination"
            sections={PICKER_SECTIONS}
            selectable
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )
      }
      render(<Picker />)

      const topLevel = screen.getByRole('button', { name: /Top level/ })
      expect(topLevel).toHaveAttribute('aria-pressed', 'false')

      await userEvent.click(topLevel)
      expect(topLevel).toHaveAttribute('aria-pressed', 'true')
    })

    it('marks the current location and disables a node that would create a cycle, with the reason reachable as text', () => {
      render(<Tree label="Choose a destination" sections={PICKER_SECTIONS} selectable />)

      expect(screen.getByText('current location')).toBeInTheDocument()
      const disallowed = screen.getByRole('button', { name: /Onboarding/ })
      expect(disallowed).toBeDisabled()
      expect(screen.getByText('Would move the document into itself')).toBeInTheDocument()
    })

    it('has no axe violations', async () => {
      const { container } = render(
        <Tree label="Choose a destination" sections={PICKER_SECTIONS} selectable />,
      )
      await expectNoAccessibilityViolations(container)
    })
  })
})
