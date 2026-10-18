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

describe('canonicaliseLinks with the application’s own origin', () => {
  const ORIGINS = ['https://docs.acme.test']

  it('stores an absolute address of this application relative, then canonical', async () => {
    const markdown = [
      `[a](https://docs.acme.test/w/engineering/d/authentication-${KEY}#user-content-setup)`,
      `[b](https://docs.acme.test/d/${OTHER_KEY}?tab=python)`,
      `[c](https://docs.acme.test/d/${OTHER})`,
    ].join('\n')

    expect(await canonicaliseLinks(uow.repos.documents, markdown, ORIGINS)).toBe(
      [
        `[a](/d/${DOC}#user-content-setup)`,
        `[b](/d/${OTHER_KEY}?tab=python)`,
        `[c](/d/${OTHER})`,
      ].join('\n'),
    )
  })

  it('leaves another origin, and this origin’s other addresses, exactly as written', async () => {
    const markdown = [
      `[a](https://elsewhere.test/w/engineering/d/authentication-${KEY})`,
      `[b](https://docs.acme.test.evil.test/d/${OTHER})`,
      '[c](https://docs.acme.test/s/site/page)',
      `[d](http://docs.acme.test/d/${OTHER})`,
    ].join('\n')

    expect(await canonicaliseLinks(uow.repos.documents, markdown, ORIGINS)).toBe(markdown)
  })

  it('recognises the origin with its punctuation escaped, as the serialiser writes a port', async () => {
    const markdown = String.raw`[a](http://localhost\:5173/d/${OTHER})`

    expect(await canonicaliseLinks(uow.repos.documents, markdown, ['http://localhost:5173'])).toBe(
      `[a](/d/${OTHER})`,
    )
  })

  it('touches no absolute address when it is not told which origin is its own', async () => {
    const markdown = `[a](https://docs.acme.test/d/${OTHER})`

    expect(await canonicaliseLinks(uow.repos.documents, markdown)).toBe(markdown)
  })
})
