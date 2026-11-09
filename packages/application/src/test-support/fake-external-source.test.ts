import { describe, expect, it } from 'vitest'

import { FakeSource, toFile } from './fake-external-source.ts'

async function all<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const item of items) collected.push(item)
  return collected
}

describe('the fake external source', () => {
  it('lists every file before it is narrowed, and only those under its paths after', async () => {
    const source = new FakeSource([{ id: 'c1', files: { 'docs/a.md': '# A', 'src/b.ts': 'b' } }])
    expect((await all(source.files('c1'))).map(({ path }) => path)).toEqual([
      'docs/a.md',
      'src/b.ts',
    ])
    await source.narrow(['docs'])
    expect((await all(source.files('c1'))).map(({ path }) => path)).toEqual(['docs/a.md'])
  })

  it('has no file at all before its first revision', async () => {
    expect(await new FakeSource().file('empty', 'docs/a.md')).toBeNull()
  })

  it('reports a rename across the edge of its paths as the diff limited to them would', async () => {
    const source = new FakeSource([
      {
        id: 'c1',
        files: { 'docs/in.md': '# In', 'notes/out.md': '# Out', 'notes/x.md': 'x' },
      },
      {
        id: 'c2',
        files: { 'notes/in.md': '# In', 'docs/out.md': '# Out', 'notes/y.md': 'x' },
        renames: {
          'docs/in.md': 'notes/in.md',
          'notes/out.md': 'docs/out.md',
          'notes/x.md': 'notes/y.md',
        },
      },
    ])
    await source.narrow(['docs'])
    expect(await all(source.changes('c1', 'c2'))).toEqual([
      { kind: 'removed', path: 'docs/in.md' },
      { kind: 'added', file: toFile('docs/out.md', '# Out') },
    ])
  })

  it('refuses a revision it does not have, and a file id that is not a file', async () => {
    const source = new FakeSource([{ id: 'c1', files: {} }])
    await expect(all(source.files('c9'))).rejects.toMatchObject({ reason: 'unknown-revision' })
    await expect(
      all(source.readFiles(['x#{"kind":"symbolic-link","target":"y"}'])),
    ).rejects.toThrow('is not a file')
  })

  it('refuses to continue a history from a revision that is not an ancestor', async () => {
    const source = new FakeSource([{ id: 'c1', files: { 'a.md': '# A' } }])
    await expect(all(source.history('c0', 'c1'))).rejects.toMatchObject({
      reason: 'history-rewritten',
    })
  })
})
