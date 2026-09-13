import { describe, expect, it } from 'vitest'

import { MemoryObjectStore } from '../memory-object-store.ts'
import { GitRepository } from './git-repository.ts'
import { hashObject } from './objects.ts'
import { MODE_FILE } from './tree.ts'
import { ContentPathError, parseContentPath, resolvePath, setPath, walkTree } from './tree-path.ts'

const EMPTY_TREE = hashObject('tree', Buffer.alloc(0))

function repository(): GitRepository {
  return new GitRepository(new MemoryObjectStore())
}

async function paths(repo: GitRepository, tree: string): Promise<string[]> {
  const found: string[] = []
  for await (const entry of walkTree(repo, tree)) found.push(entry.path)
  return found
}

describe('parseContentPath', () => {
  it('splits a nested path into directories and a name', () => {
    expect(parseContentPath('a/b/c.md')).toEqual({
      normalised: 'a/b/c.md',
      directories: ['a', 'b'],
      name: 'c.md',
    })
  })

  it('treats a top-level path as having no directories', () => {
    expect(parseContentPath('README.md').directories).toEqual([])
  })

  it('normalises Unicode to NFC so one name is one tree entry', () => {
    const decomposed = `Gro${String.fromCodePoint(0x0308)}ße.md`
    expect(parseContentPath(decomposed).normalised).toBe('Größe.md')
  })

  it.each(['', 'a//b.md', 'a/./b.md', '../secrets.md', 'a/'])('rejects "%s"', (path) => {
    expect(() => parseContentPath(path)).toThrow(ContentPathError)
  })

  it('rejects a path containing a NUL', () => {
    expect(() => parseContentPath('a\0b.md')).toThrow(/Invalid content path/)
  })

  it.each([
    ['.git/config', 'the repository itself'],
    ['.GIT/config', 'the repository in another case'],
    ['a/.Git/hooks/pre-commit.md', 'the repository further down'],
    ['git~1/config', "Windows's 8.3 alias for it"],
    ['.gitmodules', 'a file git fsck reads as a submodule declaration'],
    ['.gitattributes', 'a file that changes how git treats a checkout'],
    ['.gitignore', 'a file that changes what a checkout sees'],
    ['a\\b.md', 'a Windows separator inside one name'],
    ['notes./a.md', 'a segment Windows would strip a dot from'],
    ['notes /a.md', 'a segment Windows would strip a space from'],
    ['a.md', 'a control character'],
  ])('rejects "%s": %s', (path) => {
    expect(() => parseContentPath(path)).toThrow(ContentPathError)
  })

  it('allows a dotted directory that is not the repository', () => {
    expect(parseContentPath('.quill/workspace.yaml').directories).toEqual(['.quill'])
  })

  it('allows a dot inside a name, where Windows keeps it', () => {
    expect(parseContentPath('release.notes.md').name).toBe('release.notes.md')
  })
})

describe('setPath', () => {
  it('builds the directories a new path needs', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a/b/c.md', repo.stageBlob('hello\n'))
    expect(await paths(repo, tree)).toEqual(['a/b/c.md'])
  })

  it('replaces a blob in place without disturbing its siblings', async () => {
    const repo = repository()
    let tree = await setPath(repo, null, 'a/one.md', repo.stageBlob('one\n'))
    tree = await setPath(repo, tree, 'a/two.md', repo.stageBlob('two\n'))
    tree = await setPath(repo, tree, 'a/one.md', repo.stageBlob('one again\n'))
    expect(await paths(repo, tree)).toEqual(['a/one.md', 'a/two.md'])
    const oid = await resolvePath(repo, tree, 'a/one.md')
    expect(oid).not.toBeNull()
    expect(await repo.readBlobText(String(oid))).toBe('one again\n')
  })

  it('prunes directories it empties, as git does', async () => {
    const repo = repository()
    let tree = await setPath(repo, null, 'a/b/c.md', repo.stageBlob('hello\n'))
    tree = await setPath(repo, tree, 'a/b/c.md', null)
    expect(tree).toBe(EMPTY_TREE)
  })

  it('leaves a tree alone when asked to delete a path that is not there', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a.md', repo.stageBlob('hello\n'))
    expect(await setPath(repo, tree, 'b.md', null)).toBe(tree)
  })

  it('replaces a file with a directory of the same name', async () => {
    const repo = repository()
    let tree = await setPath(repo, null, 'notes', repo.stageBlob('loose note\n'))
    tree = await setPath(repo, tree, 'notes/one.md', repo.stageBlob('one\n'))
    expect(await paths(repo, tree)).toEqual(['notes/one.md'])
  })

  it('returns the empty tree when the last document is deleted', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a.md', null)
    expect(tree).toBe(EMPTY_TREE)
  })
})

describe('resolvePath', () => {
  it('finds a blob several directories down', async () => {
    const repo = repository()
    const blob = repo.stageBlob('hello\n')
    const tree = await setPath(repo, null, 'a/b/c.md', blob)
    expect(await resolvePath(repo, tree, 'a/b/c.md')).toBe(blob)
  })

  it('returns null for a missing directory', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a/b.md', repo.stageBlob('hello\n'))
    expect(await resolvePath(repo, tree, 'zz/b.md')).toBeNull()
  })

  it('returns null for a missing file in a directory that exists', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a/b.md', repo.stageBlob('hello\n'))
    expect(await resolvePath(repo, tree, 'a/zz.md')).toBeNull()
  })

  it('does not mistake a directory for a document', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a/b.md', repo.stageBlob('hello\n'))
    expect(await resolvePath(repo, tree, 'a')).toBeNull()
  })
})

describe('walkTree', () => {
  it('yields blobs depth first with their full paths', async () => {
    const repo = repository()
    let tree = await setPath(repo, null, 'a/b/deep.md', repo.stageBlob('deep\n'))
    tree = await setPath(repo, tree, 'top.md', repo.stageBlob('top\n'))
    expect(await paths(repo, tree)).toEqual(['a/b/deep.md', 'top.md'])
  })

  it('is lazy: a caller that stops early does not read the whole tree', async () => {
    const repo = repository()
    let tree = await setPath(repo, null, 'a.md', repo.stageBlob('a\n'))
    tree = await setPath(repo, tree, 'b.md', repo.stageBlob('b\n'))
    for await (const entry of walkTree(repo, tree)) {
      expect(entry.path).toBe('a.md')
      break
    }
  })

  it('yields nothing for the empty tree', async () => {
    const repo = repository()
    expect(await paths(repo, repo.stageTree([]))).toEqual([])
  })
})

describe('tree entries', () => {
  it('keeps the file mode the store writes', async () => {
    const repo = repository()
    const tree = await setPath(repo, null, 'a.md', repo.stageBlob('hello\n'))
    expect((await repo.readTree(tree)).map((entry) => entry.mode)).toEqual([MODE_FILE])
  })
})
