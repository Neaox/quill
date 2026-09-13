import { describe, expect, it } from 'vitest'

import type { SearchHit, SearchResults } from '../../lib/api/index.ts'
import { searchSections, sectionsHitCount } from './sections.ts'

function hit(title: string, workspaceId = 'ws-1'): SearchHit {
  return {
    documentId: `doc-${title}`,
    shortId: 'k7m3q9v2xd',
    slug: 'slug',
    title,
    path: 'runbooks/slug',
    workspaceId,
    breadcrumb: ['Engineering', 'Runbooks'],
    snippet: { text: title, ranges: [] },
    score: 1,
  }
}

function page(overrides: Partial<SearchResults> = {}): SearchResults {
  return { query: 'failover', current: [], elsewhere: [], ...overrides }
}

const PLATFORM = { id: 'ws-2', slug: 'platform-docs', name: 'Platform docs' }
const DESIGN = { id: 'ws-3', slug: 'design', name: 'Design' }

describe('searchSections', () => {
  it('puts the current workspace first, under its own heading', () => {
    const sections = searchSections(
      [
        page({
          current: [hit('Regional failover')],
          elsewhere: [{ workspace: PLATFORM, hits: [hit('Charter', 'ws-2')] }],
        }),
      ],
      { id: 'ws-1', slug: 'engineering' },
    )

    expect(sections.map((section) => [section.id, section.label, section.workspaceSlug])).toEqual([
      ['current', 'In this workspace', 'engineering'],
      ['ws-2', 'Platform docs', 'platform-docs'],
    ])
  })

  it('offers no current section when the search was run from outside a workspace', () => {
    const sections = searchSections(
      [page({ elsewhere: [{ workspace: PLATFORM, hits: [hit('Charter', 'ws-2')] }] })],
      null,
    )

    expect(sections.map((section) => section.id)).toEqual(['ws-2'])
  })

  it('omits a current section the server answered with nothing for', () => {
    const sections = searchSections(
      [page({ elsewhere: [{ workspace: PLATFORM, hits: [hit('Charter', 'ws-2')] }] })],
      { id: 'ws-1', slug: 'engineering' },
    )

    expect(sections.map((section) => section.id)).toEqual(['ws-2'])
  })

  it('merges a workspace that appears on more than one page into one heading', () => {
    const sections = searchSections(
      [
        page({
          current: [hit('First')],
          elsewhere: [{ workspace: PLATFORM, hits: [hit('Charter', 'ws-2')] }],
        }),
        page({
          current: [hit('Second')],
          elsewhere: [
            { workspace: PLATFORM, hits: [hit('Runbook', 'ws-2')] },
            { workspace: DESIGN, hits: [hit('Tokens', 'ws-3')] },
          ],
        }),
      ],
      { id: 'ws-1', slug: 'engineering' },
    )

    expect(sections.map((section) => section.id)).toEqual(['current', 'ws-2', 'ws-3'])
    expect(sections[0]?.hits.map((entry) => entry.title)).toEqual(['First', 'Second'])
    expect(sections[1]?.hits.map((entry) => entry.title)).toEqual(['Charter', 'Runbook'])
  })

  it('keeps the order a workspace was first offered in, not the order of the last page', () => {
    const sections = searchSections(
      [
        page({ elsewhere: [{ workspace: DESIGN, hits: [hit('Tokens', 'ws-3')] }] }),
        page({
          elsewhere: [
            { workspace: PLATFORM, hits: [hit('Charter', 'ws-2')] },
            { workspace: DESIGN, hits: [hit('Type', 'ws-3')] },
          ],
        }),
      ],
      null,
    )

    expect(sections.map((section) => section.id)).toEqual(['ws-3', 'ws-2'])
  })

  it('drops a group the server sent with no hits in it', () => {
    const sections = searchSections(
      [page({ elsewhere: [{ workspace: PLATFORM, hits: [] }] })],
      null,
    )

    expect(sections).toEqual([])
  })

  it('is empty for an answer that matched nothing anywhere', () => {
    expect(searchSections([page()], { id: 'ws-1', slug: 'engineering' })).toEqual([])
  })
})

describe('sectionsHitCount', () => {
  it('counts every hit across every section', () => {
    const sections = searchSections(
      [
        page({
          current: [hit('One'), hit('Two')],
          elsewhere: [{ workspace: PLATFORM, hits: [hit('Three', 'ws-2')] }],
        }),
      ],
      { id: 'ws-1', slug: 'engineering' },
    )

    expect(sectionsHitCount(sections)).toBe(3)
    expect(sectionsHitCount([])).toBe(0)
  })
})
