import { describe, expect, it } from 'vitest'
import type { OutlineEntry } from '@quill/application'

import {
  renderTableOfContents,
  TABLE_OF_CONTENTS_DEPTH,
  TABLE_OF_CONTENTS_MINIMUM,
} from './table-of-contents.ts'

const entry = (
  id: string,
  depth: number,
  text: string,
  children: readonly OutlineEntry[] = [],
): OutlineEntry => ({ id, depth, text, children })

const three = [
  entry('user-content-create', 2, 'Create a token', [entry('user-content-scopes', 3, 'Scopes')]),
  entry('user-content-revoke', 2, 'Revoke a token'),
]

describe('the table of contents', () => {
  it('is a labelled landmark linking each heading by the id the renderer emitted', () => {
    const html = renderTableOfContents(three).value
    expect(html).toContain('<nav class="site-toc" aria-labelledby="site-toc-heading">')
    expect(html).toContain('href="#user-content-create"')
    expect(html).toContain('href="#user-content-scopes"')
    expect(html).toContain('class="toc-depth-3"')
  })

  it('lists the second and third levels only: the title is not a section of itself', () => {
    const html = renderTableOfContents([
      entry('title', 1, 'The title', [
        ...three,
        entry('deep-parent', 2, 'Kept', [entry('c', 3, 'Kept too', [entry('d', 4, 'Too deep')])]),
      ]),
    ]).value
    expect(TABLE_OF_CONTENTS_DEPTH).toBe(3)
    expect(html).not.toContain('The title')
    expect(html).toContain('Kept too')
    expect(html).not.toContain('Too deep')
  })

  it('is left out until there are enough headings to be worth a column', () => {
    expect(TABLE_OF_CONTENTS_MINIMUM).toBe(3)
    expect(renderTableOfContents(three.slice(1)).value).toBe('')
    expect(renderTableOfContents([entry('t', 1, 'Title', three)]).value).not.toBe('')
  })

  it('renders nothing for a document with no headings', () => {
    expect(renderTableOfContents([]).value).toBe('')
  })

  it('escapes a heading, which an author wrote', () => {
    expect(renderTableOfContents([entry('a', 2, '<script>'), ...three]).value).toContain(
      '&lt;script&gt;',
    )
  })
})
