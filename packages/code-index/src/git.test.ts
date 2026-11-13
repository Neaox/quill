import { describe, expect, it } from 'vitest'

import { blobShas, headCommit, worktreeBlobShas, worktreeFiles } from './git.ts'

const root = process.cwd()

describe('git file set', () => {
  it('lists this package from the worktree, not only from HEAD', () => {
    expect(worktreeFiles(root)).toContain('packages/code-index/package.json')
  })

  it('reads a blob for every listed file', () => {
    const files = worktreeFiles(root).filter((file) => file.startsWith('packages/code-index/'))
    const blobs = worktreeBlobShas(root, files)

    expect(blobs.size).toBe(files.length)
    for (const blob of blobs.values()) expect(blob).toMatch(/^[\da-f]{40}$/)
  })

  it('reads the committed blob of a tracked file', () => {
    expect(blobShas(root).get('packages/domain/src/result.ts')).toMatch(/^[\da-f]{40}$/)
  })

  it('reads a full commit id', () => {
    expect(headCommit(root)).toMatch(/^[\da-f]{40}$/)
  })
})
