import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getHistory, namedSlug, readOrganisationSettings, readPublished } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { loadDemoContent } from './demo/content.ts'
import {
  DEMO_LABELS,
  DEMO_ORGANISATION_NAME,
  DEMO_PEOPLE,
  DEMO_WORKSPACES,
} from './demo/structure.ts'
import type { DemoSeedResult } from './seed-demo.ts'
import { objections, seedDemoData, withDocumentLinks } from './seed-demo.ts'
import { seedDevelopmentData, WRITER_EMAIL } from './seed.ts'

/**
 * The demo is a second seed, so it is held to the first one's bar: everything
 * goes through the use cases, the content publishes cleanly, and running it
 * twice changes nothing.
 */

const content = loadDemoContent()
const SLOW = 120_000

let harness: ServerHarness
let first: DemoSeedResult

beforeAll(async () => {
  harness = await createServerHarness()
  await seedDevelopmentData(harness.deps)
  first = await seedDemoData(harness.deps)
}, SLOW)

afterAll(async () => {
  await harness.close()
})

async function documentTitled(title: string) {
  const document = content.find((candidate) => candidate.title === title)
  if (document === undefined) throw new Error(`The demo has no document titled ${title}`)
  const workspace = await harness.deps.uow.repos.workspaces.findBySlug(document.workspace)
  const row = await harness.deps.uow.repos.documents.findByPath(
    workspace?.id ?? ('' as never),
    `${namedSlug(document.collection)}/${namedSlug(title)}.md`,
  )
  if (row === null) throw new Error(`${title} was not created`)
  return row
}

const revisionsOf = async (documentId: DocumentId) =>
  (await getHistory(harness.deps, { documentId, limit: 100 })).revisions

describe('seedDemoData', () => {
  it('publishes the whole demo without the pipeline objecting to any of it', () => {
    expect(first.problems).toEqual([])
    expect(first.documents).toBe(content.length)
    expect(first.workspaces).toBe(DEMO_WORKSPACES.length)
    expect(first.revisions).toBe(content.reduce((sum, { revisions }) => sum + revisions.length, 0))
  })

  it('turns every collection of a public workspace into a site, and no other', async () => {
    const publicWorkspaces = DEMO_WORKSPACES.filter(({ audience }) => audience === 'public')
    const sites = []
    const wrong = []
    for (const { slug } of DEMO_WORKSPACES) {
      const workspace = await harness.deps.uow.repos.workspaces.findBySlug(slug)
      const collections = await harness.deps.uow.repos.collections.listByWorkspace(
        workspace?.id ?? ('' as never),
      )
      const enabled = collections.filter(({ publicSite }) => publicSite?.enabled === true)
      if (enabled.length > 0 !== publicWorkspaces.some((w) => w.slug === slug)) wrong.push(slug)
      sites.push(...enabled)
    }
    expect(wrong).toEqual([])
    expect(sites).toHaveLength(first.publicSites)
    expect(sites.map(({ publicSite }) => publicSite?.siteSlug)).toContain('guides')
  })

  it('gives a long history several authors, in order, in the past', async () => {
    const shared = content.find(
      ({ owners, revisions }) => owners.length > 1 && revisions.length > 2,
    )
    const history = await revisionsOf((await documentTitled(shared?.title ?? '')).id)

    expect(history).toHaveLength(shared?.revisions.length ?? 0)
    const times = history.map(({ timestamp }) => timestamp.getTime()).toReversed()
    expect(times).toEqual(times.toSorted((a, b) => a - b))
    expect(times.every((time) => time < Date.now())).toBe(true)
    expect(new Set(history.map(({ author }) => author.email)).size).toBeGreaterThan(1)
    expect(history.every(({ changeNote }) => changeNote !== undefined)).toBe(true)
  })

  it('leaves a draft ahead of what is published where the content says so', async () => {
    const document = await documentTitled('Q1 2027 themes and bets')
    const [latest] = await revisionsOf(document.id)
    const draft = await harness.deps.uow.repos.drafts.find(document.id)

    expect((await readPublished(harness.deps, { documentId: document.id })).kind).toBe('found')
    // Waiting on top of the last revision, and written after it was published.
    expect(draft?.baseRevision).toBe(latest?.revision)
    expect(draft?.updatedAt.getTime()).toBeGreaterThan(latest?.timestamp.getTime() ?? Infinity)
    expect(await revisionsOf(document.id)).toHaveLength(2)
  })

  it('leaves a document that was never published with a draft and no revisions', async () => {
    const document = await documentTitled('Spec: Slack integration')

    expect((await readPublished(harness.deps, { documentId: document.id })).kind).toBe(
      'unpublished',
    )
    expect(await revisionsOf(document.id)).toEqual([])
    expect(await harness.deps.uow.repos.drafts.find(document.id)).not.toBeNull()
  })

  it('links documents to one another by id', async () => {
    const [from, to] = await Promise.all([
      documentTitled('Offline sync design'),
      documentTitled('Skiff app architecture'),
    ])
    const published = await readPublished(harness.deps, { documentId: from.id })

    expect(published.kind === 'found' ? published.markdown : '').toContain(`](/d/${to.id})`)
  })

  it('sets the organisation up: its name, labels, and permission to publish sites', async () => {
    const settings = await readOrganisationSettings(harness.deps)

    expect(settings.kind).toBe('settings')
    if (settings.kind !== 'settings') return
    expect(settings.document.name).toBe(DEMO_ORGANISATION_NAME)
    expect(settings.document.policies.publicPublishingAllowed).toBe(true)
    expect(settings.document.theme.labels?.map(({ name }) => name)).toEqual(
      DEMO_LABELS.map(({ name }) => name),
    )
  })

  it('shows the development writer some workspaces, and hides others', async () => {
    const writer = await harness.deps.uow.repos.users.findByEmail(WRITER_EMAIL)
    const rolesFor = async (slug: string) => {
      const workspace = await harness.deps.uow.repos.workspaces.findBySlug(slug)
      const grants = await harness.deps.uow.repos.grants.listForScope(
        'workspace',
        workspace?.id ?? ('' as never),
      )
      return grants.filter((grant) => grant.principalId === writer?.id).map(({ role }) => role)
    }

    expect(await rolesFor('mobile-eng')).toEqual(['editor'])
    expect(await rolesFor('support')).toEqual(['viewer'])
    expect(await rolesFor('people')).toEqual([])
    expect(await rolesFor('security')).toEqual([])
  })

  it('lets the people who write a workspace edit it, and nobody else read a team workspace', async () => {
    const dana = await harness.deps.uow.repos.users.findByEmail('dana@acme.example')
    const people = await harness.deps.uow.repos.workspaces.findBySlug('people')
    const grants = await harness.deps.uow.repos.grants.listForScope(
      'workspace',
      people?.id ?? ('' as never),
    )

    expect(grants.map(({ principalId, role }) => [principalId, role])).toEqual([
      [dana?.id, 'editor'],
    ])
    expect(DEMO_PEOPLE.map(({ email }) => email)).toContain('dana@acme.example')
  })

  it(
    'changes nothing when it runs again',
    async () => {
      const before = await revisionsOf((await documentTitled('Offline sync design')).id)

      const again = await seedDemoData(harness.deps)

      expect(again.documents).toBe(0)
      expect(again.revisions).toBe(0)
      expect(await revisionsOf((await documentTitled('Offline sync design')).id)).toEqual(before)
    },
    SLOW,
  )
})

describe('seedDemoData without the development accounts', () => {
  it('says to seed them first', async () => {
    const bare = await createServerHarness()
    try {
      await expect(seedDemoData(bare.deps)).rejects.toThrow(/Seed the development accounts first/)
    } finally {
      await bare.close()
    }
  })
})

describe('withDocumentLinks', () => {
  const id = 'f3c1a1c4-3c8e-4a56-9f9e-0d3f4bd2f111' as DocumentId

  it('turns a title into the document’s id URL', () => {
    expect(withDocumentLinks('See [it](doc:The title).', new Map([['The title', id]]))).toBe(
      `See [it](/d/${id}).`,
    )
  })

  it('refuses a title nobody has, rather than leaving a dead link', () => {
    expect(() => withDocumentLinks('[x](doc:Nothing)', new Map())).toThrow(/Nothing/)
  })

  it('leaves ordinary links alone', () => {
    expect(withDocumentLinks('[x](https://example.com)', new Map())).toBe(
      '[x](https://example.com)',
    )
  })
})

describe('objections', () => {
  const document = content.find(({ type }) => type !== 'template')
  const template = content.find(({ type }) => type === 'template')
  const outcome = {
    warnings: [
      { code: 'placeholder-remains', detail: 'a' },
      { code: 'unsupported-block', detail: 'b' },
    ],
    frontMatterIssues: [{ path: 'review.interval', keyword: 'pattern', message: 'is wrong' }],
    incompleteRequiredSections: ['Summary'],
  }

  it('words everything the pipeline said, with the document and revision', () => {
    if (document === undefined) throw new Error('The demo has no ordinary document')
    expect(objections(document, 1, outcome)).toEqual([
      `${document.title} (revision 2): placeholder-remains: a`,
      `${document.title} (revision 2): unsupported-block: b`,
      `${document.title} (revision 2): front matter review.interval: is wrong`,
      `${document.title} (revision 2): incomplete section Summary`,
    ])
  })

  it('does not hold a template to its own placeholders and unanswered sections', () => {
    if (template === undefined) throw new Error('The demo has no template')
    expect(objections(template, 0, outcome)).toEqual([
      `${template.title} (revision 1): unsupported-block: b`,
      `${template.title} (revision 1): front matter review.interval: is wrong`,
    ])
  })
})
