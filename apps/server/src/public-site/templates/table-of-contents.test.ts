import { describe, expect, it } from 'vitest'
import type { OutlineEntry } from '@quill/application'

import { renderTableOfContents, TABLE_OF_CONTENTS_DEPTH } from './table-of-contents.ts'

const entry = (
  id: string,
  depth: number,
  text: string,
  children: readonly OutlineEntry[] = [],
): OutlineEntry => ({ id, depth, text, children })

describe('the table of contents', () => {
  it('is a labelled landmark linking each heading by the id the renderer emitted', () => {
    const html = renderTableOfContents([
      entry('user-content-create', 2, 'Create a token', [
        entry('user-content-scopes', 3, 'Scopes'),
      ]),
    ]).value
    expect(html).toContain('<nav class="site-toc" aria-labelledby="site-toc-heading">')
    expect(html).toContain('href="#user-content-create"')
    expect(html).toContain('href="#user-content-scopes"')
    expect(html).toContain('class="toc-depth-3"')
  })

  it('stops at the depth it says it stops at', () => {
    const html = renderTableOfContents([
      entry('a', 2, 'Kept', [entry('b', 3, 'Kept too', [entry('c', 4, 'Too deep')])]),
    ]).value
    expect(TABLE_OF_CONTENTS_DEPTH).toBe(3)
    expect(html).toContain('Kept too')
    expect(html).not.toContain('Too deep')
  })

  it('renders nothing for a document with no headings', () => {
    expect(renderTableOfContents([]).value).toBe('')
  })

  it('renders nothing when every heading is below the cut-off', () => {
    expect(renderTableOfContents([entry('a', 4, 'Deep')]).value).toBe('')
  })

  it('escapes a heading, which an author wrote', () => {
    expect(renderTableOfContents([entry('a', 2, '<script>')]).value).toContain('&lt;script&gt;')
  })
})
