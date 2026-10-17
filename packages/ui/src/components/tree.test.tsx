import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ThemeVariantsProvider } from '../theme/theme-variants.tsx'
import { Tree, type TreeLoadRequest, type TreeNode, type TreeSection } from './tree.tsx'

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

  it('shows a section count beside its label, and says what it counts', async () => {
    const counted = SECTIONS.map((section, index) => ({ ...section, count: index === 0 ? 4 : 1 }))
    const { container } = render(<Tree label="Documents" sections={counted} />)

    expect(screen.getByText('engineering', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('engineering').parentElement).toHaveTextContent(
      'engineering4 documents',
    )
    expect(screen.getByText('product').parentElement).toHaveTextContent('product1 document')
    await expectNoAccessibilityViolations(container)
  })

  it('draws no count for a section that does not give one', () => {
    render(<Tree label="Documents" sections={SECTIONS} />)

    expect(screen.getByText('engineering').parentElement).toHaveTextContent(/^engineering$/)
  })

  it('marks nothing when no document is open', () => {
    render(<Tree label="Documents" sections={SECTIONS} />)

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
  })

  it('indents a nested branch and leaves the top level flush', () => {
    const { container } = render(
      <Tree label="Documents" sections={SECTIONS} currentId="authentication" />,
    )

    expect(container.querySelectorAll('.tree-branch')).toHaveLength(1)
  })

  it('reaches every document from the keyboard, in reading order', async () => {
    render(<Tree label="Documents" sections={SECTIONS} currentId="authentication" />)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: /engineering/ })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Collapse architecture' })).toHaveFocus()

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

/** A collection shaped like the seed's "Stress log": thousands of siblings, one deep chain. */
function stressSection(siblings: number): TreeSection {
  let deep: TreeNode = { id: 'deep-5', label: 'Deep 5', link: { to: '#deep-5' } }
  for (let level = 4; level >= 1; level -= 1) {
    deep = {
      id: `deep-${level}`,
      label: `Deep ${level}`,
      link: { to: `#deep-${level}` },
      children: [deep],
    }
  }
  return {
    id: 'stress',
    label: 'Stress log',
    nodes: [
      deep,
      ...Array.from({ length: siblings }, (_, index) => ({
        id: `entry-${index + 1}`,
        label: `Entry ${index + 1}`,
        link: { to: `#entry-${index + 1}` },
      })),
    ],
  }
}

describe('a tree that folds and pages', () => {
  it('starts closed, with a named disclosure beside each node that has children', async () => {
    const { container } = render(<Tree label="Documents" sections={SECTIONS} />)

    const disclosure = screen.getByRole('button', { name: 'Expand architecture' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    // Closed children are not drawn at all, not merely hidden.
    expect(screen.queryByRole('link', { name: 'system-overview' })).not.toBeInTheDocument()
    // A leaf has no disclosure.
    expect(screen.queryByRole('button', { name: /runbooks$/ })).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(container)

    await userEvent.click(disclosure)
    expect(screen.getByRole('button', { name: 'Collapse architecture' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('link', { name: 'system-overview' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('opens with ArrowRight and closes with ArrowLeft from the disclosure', async () => {
    render(<Tree label="Documents" sections={SECTIONS} />)

    screen.getByRole('button', { name: 'Expand architecture' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('link', { name: 'authentication' })).toBeInTheDocument()

    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('link', { name: 'authentication' })).not.toBeInTheDocument()
  })

  it('opens the ancestors of the document being read, and nothing else', () => {
    render(<Tree label="Documents" sections={[stressSection(3)]} currentId="deep-5" />)

    expect(screen.getByRole('link', { name: 'Deep 5' })).toHaveAttribute('aria-current', 'page')
    for (const level of [1, 2, 3, 4]) {
      expect(screen.getByRole('button', { name: `Collapse Deep ${level}` })).toBeInTheDocument()
    }
  })

  it('reopens what was folded by hand when a document inside it is opened', async () => {
    const { rerender } = render(
      <Tree label="Documents" sections={SECTIONS} currentId="authentication" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Collapse architecture' }))
    expect(screen.queryByRole('link', { name: 'authentication' })).not.toBeInTheDocument()

    rerender(<Tree label="Documents" sections={SECTIONS} currentId="system-overview" />)
    expect(screen.getByRole('link', { name: 'system-overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('folds a whole section from its label', async () => {
    render(<Tree label="Documents" sections={SECTIONS} />)

    const toggle = screen.getByRole('button', { name: 'product' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'specifications' })).not.toBeInTheDocument()
  })

  it('remembers what was opened by hand for the session, under its key', async () => {
    const first = render(<Tree label="Documents" sections={SECTIONS} persistenceKey="ws-1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Expand architecture' }))
    first.unmount()

    render(<Tree label="Documents" sections={SECTIONS} persistenceKey="ws-1" />)
    expect(screen.getByRole('link', { name: 'system-overview' })).toBeInTheDocument()
    sessionStorage.clear()
  })

  it('draws one page of a branch of thousands, and the rest a press at a time', async () => {
    const { container } = render(
      <Tree label="Documents" sections={[stressSection(20_000)]} pageSize={50} />,
    )

    expect(screen.getAllByRole('link')).toHaveLength(50)
    const more = screen.getByRole('button', {
      name: /^Show 50 more,\s*19,951 not shown, in Stress log$/,
    })
    await userEvent.click(more)
    expect(screen.getAllByRole('link')).toHaveLength(100)
    // The control stays where it was, with focus, for the next page.
    expect(screen.getByRole('button', { name: /^Show 50 more/ })).toHaveFocus()
    await expectNoAccessibilityViolations(container)
  })

  it('draws the page that holds the open document, not everything before it', async () => {
    render(
      <Tree
        label="Documents"
        sections={[stressSection(20_000)]}
        currentId="entry-12345"
        pageSize={50}
      />,
    )

    expect(screen.getByRole('link', { name: 'Entry 12345' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getAllByRole('link')).toHaveLength(50)

    await userEvent.click(screen.getByRole('button', { name: /^Show 50 earlier/ }))
    expect(screen.getAllByRole('link')).toHaveLength(100)
    // Focus lands on the first row revealed rather than falling to the page.
    expect(screen.getByRole('link', { name: 'Entry 12250' })).toHaveFocus()
  })

  it('scrolls the open document into view when it is out of sight', async () => {
    const scrolled = vi.fn<(this: Element, options?: ScrollIntoViewOptions) => void>()
    const measure = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 5_000, 200, 28))
    Element.prototype.scrollIntoView = scrolled
    try {
      render(<Tree label="Documents" sections={[stressSection(3)]} currentId="deep-5" />)
      // Far below the window: brought to the middle of its container, in the
      // next frame.
      await waitFor(() => {
        expect(scrolled.mock.contexts.map((element) => element.textContent)).toEqual(['Deep 5'])
      })
      expect(scrolled).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
    } finally {
      measure.mockRestore()
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('opens the way to the chosen and the current destination in a picker', () => {
    render(
      <Tree
        label="Choose a destination"
        selectable
        selectedId="deep-3"
        sections={[stressSection(5)]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Deep 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Deep 5' })).not.toBeInTheDocument()
  })
})

/** A section of 120 documents of which 50 were sent, the first with children not sent. */
const lazy = (children?: readonly TreeNode[]): readonly TreeSection[] => [
  {
    id: 'guides',
    label: 'Guides',
    nodeCount: 120,
    nodes: Array.from({ length: 50 }, (_, index) => ({
      id: `top-${index}`,
      label: `Top ${index}`,
      link: { to: `#top-${index}` },
      ...(index === 0 ? { childCount: 3, children: children ?? [] } : {}),
    })),
  },
]

/** A chain four levels deep with twenty siblings at each level. */
function siblingChain(depth: number): TreeNode {
  return {
    id: `level-${depth}`,
    label: `Level ${depth}`,
    link: { to: '#' },
    children: [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `level-${depth}-sibling-${index}`,
        label: `Sibling ${depth}.${index}`,
        link: { to: '#' },
      })),
      ...(depth < 4 ? [siblingChain(depth + 1)] : []),
    ],
  }
}

describe('a tree given only part of its lists', () => {
  it('asks for the children of a node it opens, and says it is loading them', async () => {
    const onLoad = vi.fn<(request: TreeLoadRequest) => void>()
    const { rerender, container } = render(
      <Tree label="Documents" sections={lazy()} onLoad={onLoad} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Expand Top 0' }))
    expect(onLoad).toHaveBeenCalledWith({
      owner: { kind: 'node', id: 'top-0' },
      offset: 0,
      limit: 3,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Loading documents in Top 0')
    await expectNoAccessibilityViolations(container)

    rerender(
      <Tree
        label="Documents"
        sections={lazy([{ id: 'child', label: 'Child', link: { to: '#child' } }])}
        onLoad={onLoad}
      />,
    )
    expect(screen.getByRole('link', { name: 'Child' })).toBeInTheDocument()
  })

  it('counts what it was not given, and asks for the next page when it is wanted', async () => {
    const onLoad = vi.fn<(request: TreeLoadRequest) => void>()
    render(<Tree label="Documents" sections={lazy()} onLoad={onLoad} />)

    await userEvent.click(screen.getByRole('button', { name: /^Show 50 more,\s*70 not shown/ }))
    expect(onLoad).toHaveBeenCalledWith({
      owner: { kind: 'section', id: 'guides' },
      offset: 50,
      limit: 50,
    })
  })

  it('shows the way down and a few rows around it at each ancestor level', () => {
    render(
      <Tree
        label="Documents"
        sections={[{ id: 's', label: 's', nodes: [siblingChain(1)] }]}
        currentId="level-4-sibling-10"
      />,
    )

    // Levels 1–3 show the way down and three rows either side; level 4, the
    // open document's own, shows its page.
    const links = screen.getAllByRole('link').map((link) => link.textContent)
    expect(links.filter((name) => name?.startsWith('Sibling 2.'))).toHaveLength(3)
    expect(links.filter((name) => name?.startsWith('Sibling 4.'))).toHaveLength(20)
    // One press shows all of them, so no second count repeats the first.
    expect(screen.getAllByRole('button', { name: /^Show 17 earlier, in Level \d$/ })).toHaveLength(
      3,
    )
  })
})
