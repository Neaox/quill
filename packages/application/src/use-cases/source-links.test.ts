import { describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { DocumentRow } from '../ports/persistence.ts'
import {
  isRelativeDestination,
  outsideLinks,
  relativeDestinations,
  repositoryTarget,
  resolveSourceLinks,
  sourceLinksAt,
} from './source-links.ts'

const AUTH = documentId('00000000-0000-4000-8000-000000000201')

describe('isRelativeDestination', () => {
  it.each(['guide.md', './guide.md', '../adr/0001.md#rotation', 'diagrams/flow.png?raw=1'])(
    'takes %s as relative to the file',
    (url) => {
      expect(isRelativeDestination(url)).toBe(true)
    },
  )

  it.each([
    '',
    'https://example.test/a.md',
    'mailto:ada@example.com',
    '/docs/guide.md',
    '//example.test/a.md',
    '\\\\server\\share',
    '#section',
    '?tab=1',
  ])('does not take %j as relative to the file', (url) => {
    expect(isRelativeDestination(url)).toBe(false)
  })
})

describe('relativeDestinations', () => {
  it('finds inline and reference destinations as the parser reads them', () => {
    const markdown = [
      'See [the ADR](../adr/0001-auth.md#rotation "Auth") and ![flow](<../diagrams/the flow.png>).',
      'A [bracketed](docs/a_(b).md) one, an [escaped](docs/a\\_b.md) one.',
      '[elsewhere](https://example.test) [here](#top) [root](/docs/a.md) [empty]()',
      '',
      '[guide]: ./guides/setup.md "Setup"',
      '   [angled]: <./with space.md>',
      '[web]: https://example.test',
    ].join('\n')

    expect([...relativeDestinations(markdown)]).toEqual([
      '../adr/0001-auth.md#rotation',
      '../diagrams/the flow.png',
      'docs/a_(b).md',
      'docs/a_b.md',
      './guides/setup.md',
      './with space.md',
    ])
  })

  it('finds each destination once', () => {
    expect([...relativeDestinations('[a](x.md) [b](x.md)')]).toEqual(['x.md'])
  })
})

describe('repositoryTarget', () => {
  it.each([
    ['docs/guide.md', 'setup.md', { path: 'docs/setup.md', fragment: null }],
    ['docs/guide.md', './setup.md#install', { path: 'docs/setup.md', fragment: 'install' }],
    ['docs/guide.md', '../adr/0001.md#', { path: 'adr/0001.md', fragment: null }],
    ['docs/guide.md', 'a//b/./c.md?plain=1#L3', { path: 'docs/a/b/c.md', fragment: 'L3' }],
    ['docs/guide.md', 'the%20flow.png', { path: 'docs/the flow.png', fragment: null }],
    ['docs/guide.md', '../', { path: '', fragment: null }],
    ['README.md', 'docs/', { path: 'docs', fragment: null }],
  ])('resolves %s → %s', (from, url, target) => {
    expect(repositoryTarget(from, url)).toEqual(target)
  })

  it('names nothing for a path that climbs out of the repository or does not decode', () => {
    expect(repositoryTarget('docs/guide.md', '../../outside.md')).toBeNull()
    expect(repositoryTarget('docs/guide.md', 'bad%zz.md')).toBeNull()
  })
})

const forge = (path: string) => `https://forge.example/blob/c1/${path}`

describe('resolveSourceLinks', () => {
  const documents = new Map([['adr/0001-auth.md', AUTH]])

  it('sends a document to its address and heading, anything else to the forge', () => {
    const { resolved, targets } = resolveSourceLinks(
      [
        '../adr/0001-auth.md#rotation',
        '../adr/0001-auth.md#user-content-rotation',
        '../adr/0001-auth.md',
        '../src/app.ts#L3',
        '../../out.md',
      ],
      { path: 'docs/guide.md', documents, outside: forge },
    )
    expect(Object.fromEntries(resolved)).toEqual({
      '../adr/0001-auth.md#rotation': { kind: 'href', href: `/d/${AUTH}#user-content-rotation` },
      '../adr/0001-auth.md#user-content-rotation': {
        kind: 'href',
        href: `/d/${AUTH}#user-content-rotation`,
      },
      '../adr/0001-auth.md': { kind: 'href', href: `/d/${AUTH}` },
      '../src/app.ts#L3': { kind: 'href', href: 'https://forge.example/blob/c1/src/app.ts#L3' },
      '../../out.md': { kind: 'text' },
    })
    expect([...targets]).toEqual([AUTH])
  })

  it('shows a link outside the source as its words when there is no forge address', () => {
    const { resolved } = resolveSourceLinks(['../src/app.ts'], {
      path: 'docs/guide.md',
      documents,
      outside: null,
    })
    expect(resolved.get('../src/app.ts')).toEqual({ kind: 'text' })
  })
})

describe('outsideLinks', () => {
  const settings = {
    remote: 'https://github.com/acme/handbook.git',
    outsideLinks: 'forge',
    viewTemplate: null,
  } as const

  it('addresses a path on the forge at the commit', () => {
    expect(outsideLinks(settings, 'c1')?.('docs/a.md')).toBe(
      'https://github.com/acme/handbook/blob/c1/docs/a.md',
    )
  })

  it('has no address when links outside are text, no commit is known, or the forge is unknown', () => {
    expect(outsideLinks({ ...settings, outsideLinks: 'text' }, 'c1')).toBeNull()
    expect(outsideLinks(settings, null)).toBeNull()
    expect(
      outsideLinks({ ...settings, remote: 'https://git.example.com/a/b.git' }, 'c1'),
    ).toBeNull()
  })
})

describe('sourceLinksAt', () => {
  const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
  const NOW = new Date('2026-01-01T00:00:00.000Z')
  const author = { name: 'Ada', email: 'ada@example.com' }

  it('resolves against the documents of the revision, leaving its other files to the forge', async () => {
    const uow = createInMemoryUnitOfWork()
    const contentStore = createFakeContentStore()
    await uow.repos.workspaces.create({
      id: WORKSPACE,
      unitId: 'acme',
      name: 'Handbook',
      slug: 'handbook',
      now: NOW,
    })
    await uow.repos.workspaceSources.put({
      workspaceId: WORKSPACE,
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      collections: [],
      history: 'full',
      commitMessages: 'subject',
      credential: null,
      outsideLinks: 'forge',
      viewTemplate: null,
      webhookSecretName: null,
      configuredBy: userId('00000000-0000-4000-8000-000000000001'),
      now: NOW,
    })
    await contentStore.publish({
      workspaceId: WORKSPACE,
      changes: [{ kind: 'write', documentId: AUTH, path: 'adr/0001-auth.md', markdown: '# Auth' }],
      author,
      base: null,
    })
    const written = await contentStore.putFile({
      workspaceId: WORKSPACE,
      path: 'adr/notes.txt',
      text: 'notes',
      expected: null,
      author,
    })
    if (written.kind !== 'published') throw new Error(written.kind)
    const document = { id: AUTH, workspaceId: WORKSPACE } as DocumentRow

    const { resolved } = await sourceLinksAt(
      { uow, contentStore },
      document,
      '[self](0001-auth.md) [notes](notes.txt)',
      { path: 'adr/0001-auth.md', revision: written.revision, head: false },
    )

    // No revision of this document names that one, so no commit is known: the forge is out.
    expect(Object.fromEntries(resolved)).toEqual({
      '0001-auth.md': { kind: 'href', href: `/d/${AUTH}` },
      'notes.txt': { kind: 'text' },
    })
  })
})
