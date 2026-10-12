import { parseDocument, serializeDocument } from '@quill/markdown'
import type { NestedListItem } from '@quill/ui'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

const OUTLINE = [
  '# Title',
  '',
  '::toc',
  '',
  '## One',
  '',
  '### Deeper',
  '',
  '#### Deepest',
  '',
  '## Two',
  '',
].join('\n')

const CHILDREN: readonly NestedListItem[] = [
  {
    id: 'a',
    label: 'Architecture',
    children: [{ id: 'a1', label: 'Overview', children: [{ id: 'a1x', label: 'Diagrams' }] }],
  },
  { id: 'b', label: 'Runbooks' },
]

function open(source: string, childDocuments?: readonly NestedListItem[]) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor
      ast={parseDocument(source).ast}
      ref={ref}
      {...(childDocuments === undefined ? {} : { childDocuments })}
    />,
  )
  return { ref, user: userEvent.setup(), ...result }
}

type Opened = ReturnType<typeof open>

/**
 * TipTap draws a React node view a moment after the editor mounts, from a portal
 * it flushes itself, so a block is waited for rather than assumed.
 */
async function openToc(source: string): Promise<Opened> {
  const opened = open(source)
  await screen.findByRole('navigation', { name: 'Table of contents' })
  return opened
}

async function openChildren(
  source: string,
  childDocuments?: readonly NestedListItem[],
): Promise<Opened> {
  const opened = open(source, childDocuments)
  await screen.findByRole('region', { name: 'Child documents' })
  return opened
}

function markdown(opened: Opened): string {
  const handle = opened.ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

const contents = (): HTMLElement => screen.getByRole('navigation', { name: 'Table of contents' })
const children = (): HTMLElement => screen.getByRole('region', { name: 'Child documents' })
const entries = (container: HTMLElement): (string | null)[] =>
  within(container)
    .getAllByRole('listitem')
    .map((item) => item.firstChild?.textContent ?? null)

describe('the table of contents block', () => {
  it('lists the headings between its levels, which by default skip the title', async () => {
    await openToc(OUTLINE)
    expect(
      within(contents())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['One', 'Deeper', 'Two'])
  })

  it('nests what it lists', async () => {
    await openToc(OUTLINE)
    expect(within(contents()).getAllByRole('list')).toHaveLength(2)
  })

  it('shows more when its last level is lowered, and writes the setting into the document', async () => {
    const opened = await openToc(OUTLINE)
    await opened.user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'Heading 4')
    expect(within(contents()).getByRole('button', { name: 'Deepest' })).toBeVisible()
    expect(markdown(opened)).toContain('::toc{min="2" max="4"}')
  })

  it('shows the title when its first level is raised to the top', async () => {
    const opened = await openToc(OUTLINE)
    await opened.user.selectOptions(screen.getByRole('combobox', { name: 'From' }), 'Heading 1')
    expect(within(contents()).getByRole('button', { name: 'Title' })).toBeVisible()
    expect(markdown(opened)).toContain('::toc{min="1" max="3"}')
  })

  it('never lets the range be empty: moving one end past the other brings the other along', async () => {
    const opened = await openToc(OUTLINE)
    await opened.user.selectOptions(screen.getByRole('combobox', { name: 'From' }), 'Heading 5')
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('5')
    await opened.user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'Heading 1')
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('1')
    expect(markdown(opened)).toContain('::toc{min="1" max="1"}')
  })

  it('offers all six heading levels at each end', async () => {
    await openToc(OUTLINE)
    const levels = within(screen.getByRole('combobox', { name: 'From' })).getAllByRole('option')
    expect(levels.map((option) => option.textContent)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Heading 5',
      'Heading 6',
    ])
  })

  it('follows the document as headings are written', async () => {
    const opened = await openToc(OUTLINE)
    const editor = opened.ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Fresh' }],
      })
    })
    expect(within(contents()).getByRole('button', { name: 'Fresh' })).toBeVisible()
  })

  it('takes the caret to a heading when its entry is chosen', async () => {
    const opened = await openToc(OUTLINE)
    await opened.user.click(within(contents()).getByRole('button', { name: 'Two' }))
    const editor = opened.ref.current?.editor
    expect(editor?.state.selection.$from.parent.textContent).toBe('Two')
    expect(editor?.isFocused).toBe(true)
  })

  it('says so, with the levels it looked between, when there is nothing to list', async () => {
    await openToc('::toc\n\nJust prose.\n')
    expect(contents()).toHaveTextContent(/No headings from Heading 2 to Heading 3 yet/)
    expect(within(contents()).queryByRole('list')).toBeNull()
  })

  it('is accessible, with settings that are labelled', async () => {
    const opened = await openToc(OUTLINE)
    await expectNoAccessibilityViolations(opened.container)
  })

  it('can be inserted from the slash menu', async () => {
    const opened = open('Start.\n')
    await opened.user.click(screen.getByRole('textbox', { name: 'Document' }))
    await opened.user.keyboard('/contents{Enter}')
    expect(await screen.findByRole('navigation', { name: 'Table of contents' })).toBeVisible()
    expect(markdown(opened)).toContain('::toc{min="2" max="3"}')
  })

  it('writes its level the way the reading surface will read it', async () => {
    const opened = await openToc('# T\n\n::toc{min=3 max=2}\n\n## B\n\n### C\n')
    // A range written the wrong way round is read the right way round.
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('2')
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('3')
    expect(markdown(opened)).toContain('::toc{min=3 max=2}')
  })
})

describe('the child documents block', () => {
  it('lists the documents beneath this one, one level deep to begin with', async () => {
    await openChildren('::children\n', CHILDREN)
    expect(entries(children())).toEqual(['Architecture', 'Runbooks'])
  })

  it('goes as deep as it is told', async () => {
    const opened = await openChildren('::children\n', CHILDREN)
    const depth = screen.getByRole('combobox', { name: 'Show' })
    await opened.user.selectOptions(depth, '2 levels')
    expect(entries(children())).toEqual(['Architecture', 'Overview', 'Runbooks'])
    await opened.user.selectOptions(depth, '3 levels')
    expect(entries(children())).toEqual(['Architecture', 'Overview', 'Diagrams', 'Runbooks'])
    expect(markdown(opened)).toContain('::children{depth="3"}')
  })

  it('offers one to five levels', async () => {
    await openChildren('::children\n', CHILDREN)
    const options = within(screen.getByRole('combobox', { name: 'Show' })).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '1 level',
      '2 levels',
      '3 levels',
      '4 levels',
      '5 levels',
    ])
  })

  it('reads the depth already written', async () => {
    await openChildren('::children{depth=2}\n', CHILDREN)
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('2')
    expect(entries(children())).toEqual(['Architecture', 'Overview', 'Runbooks'])
  })

  it('shows its entries as text, so choosing one while writing does not leave the draft', async () => {
    await openChildren('::children\n', [
      { id: 'a', label: 'Linked', link: { to: '/d/$id', params: { id: 'a' } } },
    ])
    expect(within(children()).queryByRole('link')).toBeNull()
    expect(within(children()).getByText('Linked')).toBeVisible()
  })

  it('says there are none when the application supplies an empty list, or none at all', async () => {
    const { unmount } = await openChildren('::children\n', [])
    expect(children()).toHaveTextContent(/no child documents yet/)
    unmount()
    await openChildren('::children\n')
    expect(children()).toHaveTextContent(/no child documents yet/)
  })

  it('can be inserted from the slash menu', async () => {
    const opened = open('Start.\n', CHILDREN)
    await opened.user.click(screen.getByRole('textbox', { name: 'Document' }))
    await opened.user.keyboard('/child{Enter}')
    expect(await screen.findByRole('region', { name: 'Child documents' })).toBeVisible()
    expect(markdown(opened)).toContain('::children{depth="1"}')
  })

  it('is accessible', async () => {
    const opened = await openChildren('::children\n', CHILDREN)
    await expectNoAccessibilityViolations(opened.container)
  })
})

describe('other leaf directives', () => {
  it('stay a line of editable text that survives a round trip', async () => {
    const opened = open('::documents[Recent]{limit=3}\n')
    expect(screen.getByText('Recent')).toBeVisible()
    expect(markdown(opened)).toContain('::documents[Recent]{limit=3}')
  })
})
