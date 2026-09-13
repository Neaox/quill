import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeClock } from '@quill/application/test-support'
import { documentId, workspaceId } from '@quill/domain'

import { createContentStore } from './content-store.ts'

/**
 * Both backends are the same Git object model (ADR-014): the filesystem one
 * writes a bare repository per workspace that `git` can read, and the
 * in-memory one keeps the same layout in process.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')

const MARKDOWN = `---
id: ${DOC}
---

# Overview
`

const publish = {
  workspaceId: WORKSPACE,
  base: null,
  author: { name: 'Ada', email: 'ada@example.com' },
  summary: 'Overview',
  changes: [
    {
      kind: 'write' as const,
      documentId: DOC,
      path: 'architecture/overview.md',
      markdown: `---\nid: ${DOC}\n---\n\n# Overview\n`,
    },
  ],
}

describe('createContentStore', () => {
  it('publishes and reads back in memory', async () => {
    const store = createContentStore({ driver: 'memory' }, createFakeClock(NOW))
    const result = await store.publish(publish)
    expect(result.kind).toBe('published')
    expect(await store.read(WORKSPACE, DOC)).toMatchObject({ path: 'architecture/overview.md' })
  })

  it('publishes into a bare repository on disk', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'quill-content-'))
    const store = createContentStore({ driver: 'filesystem', path: root }, createFakeClock(NOW))

    const result = await store.publish(publish)
    expect(result.kind).toBe('published')
    expect(await store.read(WORKSPACE, DOC)).toMatchObject({ markdown: MARKDOWN })

    // A repository the `git` command line would recognise (ADR-014).
    const head = await readFile(path.join(root, `${WORKSPACE}.git`, 'HEAD'), 'utf8')
    expect(head.trim()).toBe('ref: refs/heads/main')
  })
})
