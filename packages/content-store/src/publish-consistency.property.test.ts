/**
 * Publish, read, and history agree with a model of what was published, over
 * random sequences of writes, moves, and deletes (ADR-015).
 */

import type { ContentChange } from '@quill/application'
import type { DocumentId, RevisionId } from '@quill/domain'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { GitContentStore } from './git-content-store.ts'
import { MemoryObjectStoreProvider } from './memory-object-store.ts'
import {
  AUTHOR,
  JITTER,
  markdown,
  newDocument,
  newWorkspaceId,
  NOW,
  write,
} from './test-fixtures.ts'

type Operation =
  | { readonly kind: 'write'; readonly document: number; readonly body: string }
  | { readonly kind: 'move'; readonly document: number; readonly folder: string }
  | { readonly kind: 'delete'; readonly document: number }

const DOCUMENTS = 3

const document = fc.integer({ min: 0, max: DOCUMENTS - 1 })
const folder = fc.constantFrom('handbook', 'handbook/team', 'runbooks', '')
const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant('write' as const), document, body: fc.string({ maxLength: 30 }) }),
  fc.record({ kind: fc.constant('move' as const), document, folder }),
  fc.record({ kind: fc.constant('delete' as const), document }),
)

interface Live {
  readonly path: string
  readonly markdown: string
}

function pathIn(folderName: string, index: number): string {
  return folderName === '' ? `doc-${index}.md` : `${folderName}/doc-${index}.md`
}

/** The change an operation makes, or null when it cannot apply. */
function toChange(
  operation_: Operation,
  id: DocumentId,
  current: Live | undefined,
): ContentChange | null {
  if (operation_.kind === 'write') {
    const path = current?.path ?? pathIn('', operation_.document)
    return write(id, path, markdown(id, `Document ${operation_.document}`, operation_.body))
  }
  if (current === undefined) return null
  if (operation_.kind === 'delete') {
    return { kind: 'delete', documentId: id, path: current.path }
  }
  const toPath = pathIn(operation_.folder, operation_.document)
  if (toPath === current.path) return null
  return { kind: 'move', documentId: id, fromPath: current.path, toPath }
}

function applyToModel(change: ContentChange, live: Map<number, Live>, index: number): void {
  if (change.kind === 'write') live.set(index, { path: change.path, markdown: change.markdown })
  else if (change.kind === 'delete') live.delete(index)
  else {
    const previous = live.get(index)
    live.set(index, { path: change.toPath, markdown: previous?.markdown ?? '' })
  }
}

describe('publish, read, and history', () => {
  it('agree with the sequence of changes that was published', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { maxLength: 8 }), async (operations) => {
        const store = new GitContentStore({
          provider: new MemoryObjectStoreProvider(),
          now: NOW,
          random: JITTER,
        })
        const workspaceId = newWorkspaceId()
        const ids = Array.from({ length: DOCUMENTS }, () => newDocument())
        const live = new Map<number, Live>()
        const revisions = new Map<number, number>()
        let base: RevisionId | null = null

        for (const next of operations) {
          const id = ids.at(next.document)
          if (id === undefined) throw new Error('unreachable: document index is in range')
          const change = toChange(next, id, live.get(next.document))
          if (change === null) continue
          const result = await store.publish({
            workspaceId,
            changes: [change],
            author: AUTHOR,
            base,
          })
          if (result.kind !== 'published') throw new Error('a serial publish cannot conflict')
          base = result.revision
          applyToModel(change, live, next.document)
          revisions.set(next.document, (revisions.get(next.document) ?? 0) + 1)
        }

        expect(await store.head(workspaceId)).toBe(base)

        for (const [index, id] of ids.entries()) {
          const expected = live.get(index)
          const found = await store.read(workspaceId, id)
          expect(found === null ? null : { path: found.path, markdown: found.markdown }).toEqual(
            expected ?? null,
          )
          const history = await store.history(workspaceId, id, { limit: 100 })
          expect(history).toHaveLength(revisions.get(index) ?? 0)
        }

        const tree = await store.listTree(workspaceId)
        expect(tree.map((entry) => entry.path).toSorted()).toEqual(
          [...live.values()].map((entry) => entry.path).toSorted(),
        )
      }),
      { numRuns: 60 },
    )
  })
})
