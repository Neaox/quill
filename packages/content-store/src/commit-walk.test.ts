import { describe, expect, it } from 'vitest'

import { DOCUMENT_ID_TRAILER } from './branding.ts'
import { changedDocumentIds, toRevisionSummary, walkCommits } from './commit-walk.ts'
import { UTC, type GitCommit } from './git/commit.ts'
import { GitRepository } from './git/git-repository.ts'
import { parseTrailers } from './git/trailers.ts'
import { MemoryObjectStore } from './memory-object-store.ts'
import { newDocument } from './test-fixtures.ts'

const ID = newDocument()
const identity = { name: 'Ada', email: 'ada@example.com', when: 1_700_000_000, timezone: UTC }

function walked(message: string): Parameters<typeof toRevisionSummary>[0] {
  const commit: GitCommit = {
    tree: 'a'.repeat(40),
    parents: [],
    author: identity,
    committer: identity,
    message,
  }
  return { revision: 'b'.repeat(40), commit, trailers: parseTrailers(message), parent: null }
}

describe('walkCommits', () => {
  it('yields nothing for an unborn ref', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const seen = []
    for await (const commit of walkCommits(repository, null)) seen.push(commit)
    expect(seen).toEqual([])
  })

  it('walks first parents from the newest commit to the root', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const tree = repository.stageTree([])
    const base = { tree, author: identity, committer: identity }
    const root = repository.stageCommit({ ...base, parents: [], message: 'One\n' })
    const tip = repository.stageCommit({ ...base, parents: [root], message: 'Two\n' })
    const seen = []
    for await (const commit of walkCommits(repository, tip)) seen.push(commit.revision)
    expect(seen).toEqual([tip, root])
  })
})

describe('changedDocumentIds', () => {
  it('reads every document the commit says it changed', () => {
    const other = newDocument()
    const message = `Subject\n\n${DOCUMENT_ID_TRAILER}: ${ID}\n${DOCUMENT_ID_TRAILER}: ${other}\n`
    expect(changedDocumentIds(parseTrailers(message))).toEqual([ID, other])
  })

  it('ignores a trailer value that is not a document id', () => {
    const message = `Subject\n\n${DOCUMENT_ID_TRAILER}: not-an-id\n`
    expect(changedDocumentIds(parseTrailers(message))).toEqual([])
  })
})

describe('toRevisionSummary', () => {
  it('takes the subject from the first line of the message', () => {
    expect(toRevisionSummary(walked('Update Onboarding\n\nBody\n')).summary).toBe(
      'Update Onboarding',
    )
  })

  it('copes with a message that is only a subject', () => {
    expect(toRevisionSummary(walked('Update Onboarding')).summary).toBe('Update Onboarding')
  })

  it('reads the timestamp from the author, in seconds', () => {
    expect(toRevisionSummary(walked('Subject\n')).timestamp).toEqual(new Date(1_700_000_000_000))
  })
})
