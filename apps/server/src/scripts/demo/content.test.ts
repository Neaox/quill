import { describe, expect, it } from 'vitest'
import { isTemplateDeclaration, parseDocument } from '@quill/markdown'

import { loadDemoContent } from './content.ts'
import type { DemoDocument } from './content.ts'
import { DEMO_PEOPLE, DEMO_UNITS, DEMO_WORKSPACES } from './structure.ts'

/**
 * The demo's documents are authored files, so a typo is found by this test
 * rather than by whoever next seeds a database. It checks the files agree with
 * each other and with the structure; that they publish cleanly is checked by
 * `seed-demo.test.ts`, which publishes them.
 */

const content = loadDemoContent()
const titles = new Set(content.map(({ title }) => title))
const people = new Set(DEMO_PEOPLE.map(({ email }) => email))
const DOCUMENT_LINK = /\]\(doc:([^)]+)\)/g

const bodies = (document: DemoDocument): readonly string[] => [
  ...document.revisions,
  ...(document.draft === undefined ? [] : [document.draft]),
]

/** What a document has, as the three facts its status is about. */
const states = (document: DemoDocument) => ({
  published: document.revisions.length > 0,
  draft: document.draft !== undefined,
  noted: document.notes.length === document.revisions.length,
})

describe('the demo content', () => {
  it('has a believable amount of it', () => {
    expect(content.length).toBeGreaterThanOrEqual(90)
    expect(new Set(content.map(({ workspace }) => workspace)).size).toBe(DEMO_WORKSPACES.length)
  })

  it('puts every document in a declared workspace, and every workspace has some', () => {
    const declared = new Set(DEMO_WORKSPACES.map(({ slug }) => slug))
    expect(content.filter(({ workspace }) => !declared.has(workspace))).toEqual([])
    expect(
      DEMO_WORKSPACES.filter(({ slug }) => !content.some((d) => d.workspace === slug)),
    ).toEqual([])
  })

  it('groups every workspace under a declared division', () => {
    expect(DEMO_WORKSPACES.filter(({ unit }) => !DEMO_UNITS.includes(unit))).toEqual([])
  })

  it('gives every document a unique title, which is what links name', () => {
    expect(titles.size).toBe(content.length)
  })

  it('names only people who exist as owners, and gives every document one', () => {
    const wrong = content.flatMap(({ title, owners }) =>
      owners.length === 0
        ? [`${title} has no owner`]
        : owners.filter((owner) => !people.has(owner)).map((owner) => `${title}: ${owner}`),
    )
    expect(wrong).toEqual([])
  })

  it('keeps each document to what its status allows, with a change note per revision', () => {
    const expected = {
      published: { published: true, draft: false, noted: true },
      'draft-ahead': { published: true, draft: true, noted: true },
      draft: { published: false, draft: true, noted: true },
    }
    const wrong = content.filter(
      (document) => JSON.stringify(states(document)) !== JSON.stringify(expected[document.status]),
    )
    expect(wrong.map(({ title }) => title)).toEqual([])
  })

  it.each(
    content.flatMap((document) => bodies(document).map((body) => [document.title, body] as const)),
  )('%s: every version opens with its own title and parses without warnings', (title, body) => {
    expect(body.startsWith(`# ${title}\n`)).toBe(true)
    expect(parseDocument(body).warnings).toEqual([])
  })

  it('links only to documents that exist', () => {
    const dangling = content.flatMap((document) =>
      bodies(document)
        .flatMap((body) => [...body.matchAll(DOCUMENT_LINK)].map((match) => match[1]))
        .filter((target) => target !== undefined && !titles.has(target))
        .map((target) => `${document.title} → ${target}`),
    )
    expect(dangling).toEqual([])
  })

  it('declares templates as templates, and only templates', () => {
    const misdeclared = content.filter(
      ({ type, frontMatter }) =>
        isTemplateDeclaration(frontMatter['template']) !== (type === 'template'),
    )
    expect(misdeclared.map(({ title }) => title)).toEqual([])
  })

  it('has something to read on every public site', () => {
    const publicSlugs = new Set(
      DEMO_WORKSPACES.filter(({ audience }) => audience === 'public').map(({ slug }) => slug),
    )
    const readable = Map.groupBy(
      content.filter(({ workspace }) => publicSlugs.has(workspace)),
      ({ workspace, collection }) => `${workspace}/${collection}`,
    )
    const empty = [...readable]
      .filter(([, documents]) => documents.every(({ revisions }) => revisions.length === 0))
      .map(([site]) => site)
    expect(empty).toEqual([])
  })

  it('shows every state a document can be in', () => {
    const statuses = new Set(content.map(({ status }) => status))
    expect([...statuses].toSorted()).toEqual(['draft', 'draft-ahead', 'published'])
    expect(content.some(({ revisions }) => revisions.length >= 4)).toBe(true)
  })
})
