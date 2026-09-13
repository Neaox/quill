import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'

import { aShortId } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { canonicaliseLinks } from './canonical-links.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const OTHER = documentId('00000000-0000-4000-8000-000000000202')
const KEY = aShortId(3)
const OTHER_KEY = aShortId(4)
const UNKNOWN_KEY = aShortId(99)

let uow: InMemoryUnitOfWork

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  for (const [id, key, slug] of [
    [DOC, KEY, 'authentication'],
    [OTHER, OTHER_KEY, 'failover'],
  ] as const) {
    await uow.repos.documents.create({
      id,
      shortId: key,
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      slug,
      path: `architecture/${slug}.md`,
      title: slug,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
})

describe('canonicaliseLinks', () => {
  it('rewrites a link pasted out of the address bar into the canonical form', async () => {
    const markdown = `See [auth](/w/engineering/d/authentication-${KEY}).`
    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(`See [auth](/d/${DOC}).`)
  })

  it('rewrites the bare-key and UUID forms of the same link', async () => {
    const markdown = `[a](/w/engineering/d/${KEY}) [b](/w/engineering/d/${OTHER})`
    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(
      `[a](/d/${DOC}) [b](/d/${OTHER})`,
    )
  })

  it('rewrites every occurrence of a reference, and several references, in one pass', async () => {
    const markdown = [
      `[a](/w/engineering/d/authentication-${KEY})`,
      `[b](/w/platform/d/authentication-${KEY})`,
      `[c](/w/engineering/d/failover-${OTHER_KEY})`,
    ].join('\n')
    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(
      [`[a](/d/${DOC})`, `[b](/d/${DOC})`, `[c](/d/${OTHER})`].join('\n'),
    )
  })

  it('leaves a key that names nothing exactly as it was, so a broken link stays reportable', async () => {
    const markdown = `See [gone](/w/engineering/d/gone-${UNKNOWN_KEY}).`
    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(markdown)
  })

  it('leaves a reference that is neither a key nor an id alone', async () => {
    const markdown = 'See [gone](/w/engineering/d/just-words).'
    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(markdown)
  })

  it('leaves a body with no such links untouched', async () => {
    const markdown = `Already canonical: [auth](/d/${DOC}), and [external](https://example.com).`
    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(markdown)
  })
})
