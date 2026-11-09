import { documentId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import {
  folderTitle,
  generatedFolderMarkdown,
  generatedFolderOf,
  generatedFolderPath,
  isIndexFileName,
  planFolders,
  withFolderAddresses,
} from './source-folders.ts'

const GUIDE = 'guide'
const OTHER = 'other'

function plan(paths: readonly string[], root = 'docs/guide') {
  return planFolders(
    paths.map((path) => ({ path, collection: GUIDE })),
    [{ collection: GUIDE, root }],
  )
}

/** Every name an index file may have in one folder, in an order that makes them compete. */
function competing(folder: string): string[] {
  return [
    `${folder}/readme.md`,
    `${folder}/README.md`,
    `${folder}/readme.markdown`,
    `${folder}/index.md`,
    `${folder}/README.markdown`,
  ]
}

describe('generated folder paths', () => {
  it('round-trips a folder, and names no other path', () => {
    const path = generatedFolderPath('docs/guide/concepts')
    expect(path).toBe('docs/guide/concepts/.quill/folder.md')
    expect(generatedFolderOf(path)).toBe('docs/guide/concepts')
    expect(generatedFolderOf('docs/guide/concepts/README.md')).toBeNull()
    expect(generatedFolderOf('/.quill/folder.md')).toBeNull()
  })

  it('titles a folder after its name and lists its pages', () => {
    expect(folderTitle('docs/getting_started')).toBe('Getting started')
    expect(generatedFolderMarkdown('docs/concepts')).toBe('# Concepts\n\n::children{excerpts}\n')
    expect(generatedFolderMarkdown('docs/[draft]*')).toBe(
      String.raw`# \[draft\]\*` + '\n\n::children{excerpts}\n',
    )
  })

  it('knows the index file names, in any case', () => {
    expect(isIndexFileName('a/README.md')).toBe(true)
    expect(isIndexFileName('a/readme.markdown')).toBe(true)
    expect(isIndexFileName('a/Index.md')).toBe(true)
    expect(isIndexFileName('a/readme-old.md')).toBe(false)
  })
})

describe('planFolders', () => {
  it("makes a folder's README its document, the parent of the folder's other documents", () => {
    const { indexes, generated, parents } = plan([
      'docs/guide/README.md',
      'docs/guide/concepts/tenancy/README.md',
      'docs/guide/concepts/tenancy/isolation.md',
      'docs/guide/concepts/requests/README.md',
    ])
    expect([...indexes]).toEqual([
      ['docs/guide/concepts/tenancy', 'docs/guide/concepts/tenancy/README.md'],
      ['docs/guide/concepts/requests', 'docs/guide/concepts/requests/README.md'],
    ])
    expect([...generated]).toEqual([['docs/guide/concepts', GUIDE]])
    // The collection's own README is its overview.
    expect([
      ...plan(['docs/guide/README.md', 'docs/guide/index.md', 'docs/guide/a.md']).leading,
    ]).toEqual(['docs/guide/index.md'])
    const concepts = generatedFolderPath('docs/guide/concepts')
    expect(Object.fromEntries(parents)).toEqual({
      // The collection's own directory is the collection: its README is at the top.
      'docs/guide/README.md': null,
      'docs/guide/concepts/tenancy/README.md': concepts,
      'docs/guide/concepts/tenancy/isolation.md': 'docs/guide/concepts/tenancy/README.md',
      'docs/guide/concepts/requests/README.md': concepts,
      [concepts]: null,
    })
  })

  it('picks one index file however the names compete, best first and then by path', () => {
    const { indexes, leading } = plan([...competing('docs/guide'), ...competing('docs/guide/a')])
    expect(indexes.get('docs/guide/a')).toBe('docs/guide/a/index.md')
    expect([...leading]).toEqual(['docs/guide/index.md'])
    const readmes = plan(['docs/guide/a/readme.md', 'docs/guide/a/README.md', 'docs/guide/a/x.md'])
    expect(readmes.indexes.get('docs/guide/a')).toBe('docs/guide/a/README.md')
    const same = plan(['docs/guide/README.md', 'docs/guide/readme.md'])
    expect([...same.leading]).toEqual(['docs/guide/README.md'])
  })

  it('prefers index.md to README.md, which is then an ordinary child', () => {
    const { indexes, parents } = plan(['docs/guide/a/README.md', 'docs/guide/a/index.md'])
    expect(indexes.get('docs/guide/a')).toBe('docs/guide/a/index.md')
    expect(parents.get('docs/guide/a/README.md')).toBe('docs/guide/a/index.md')
    expect(parents.get('docs/guide/a/index.md')).toBeNull()
  })

  it('writes a document for each folder with no index file, nested as the folders are', () => {
    const { generated, parents } = plan(['docs/guide/a/b/c.md'])
    expect([...generated.keys()]).toEqual(['docs/guide/a/b', 'docs/guide/a'])
    expect(parents.get('docs/guide/a/b/c.md')).toBe(generatedFolderPath('docs/guide/a/b'))
    expect(parents.get(generatedFolderPath('docs/guide/a/b'))).toBe(
      generatedFolderPath('docs/guide/a'),
    )
    expect(parents.get(generatedFolderPath('docs/guide/a'))).toBeNull()
  })

  it('writes nothing for a folder with no document in it', () => {
    expect(plan(['docs/guide/a.md']).generated.size).toBe(0)
    expect(plan([]).parents.size).toBe(0)
  })

  it('reads a glob from its literal directory, and a single file as the top of its collection', () => {
    const glob = plan(['packages/a/README.md', 'packages/b/c/README.md'], 'packages')
    expect([...glob.generated.keys()]).toEqual(['packages/b'])
    expect(glob.parents.get('packages/a/README.md')).toBeNull()
    expect(glob.parents.get('packages/b/c/README.md')).toBe(generatedFolderPath('packages/b'))
    expect(plan(['docs/guide/a.md'], 'docs/guide/a.md').parents.get('docs/guide/a.md')).toBeNull()
  })

  it('reads a collection at the repository root, and ignores a trailing slash', () => {
    const rooted = plan(['README.md', 'a/README.md', 'a/b.md'], '')
    expect(rooted.parents.get('README.md')).toBeNull()
    expect(rooted.parents.get('a/b.md')).toBe('a/README.md')
    expect(plan(['docs/guide/a/b.md'], 'docs/guide/').generated.has('docs/guide/a')).toBe(true)
  })

  it('leaves a generated document a file claims out of the plan', () => {
    const { parents } = plan([generatedFolderPath('docs/guide/a'), 'docs/guide/b.md'])
    expect([...parents.keys()]).toEqual(['docs/guide/b.md'])
  })

  it('gives a folder two collections would each write to the first, and the second nests above it', () => {
    const result = planFolders(
      [
        { path: 'docs/a/b/one.md', collection: GUIDE },
        { path: 'docs/a/b/two.md', collection: OTHER },
        { path: 'docs/a/three.md', collection: OTHER },
      ],
      [
        { collection: GUIDE, root: 'docs' },
        { collection: OTHER, root: 'docs' },
        { collection: GUIDE, root: 'ignored' },
      ],
    )
    expect(Object.fromEntries(result.generated)).toEqual({ 'docs/a/b': GUIDE, 'docs/a': GUIDE })
    expect(result.parents.get('docs/a/b/two.md')).toBeNull()
    expect(result.parents.get('docs/a/three.md')).toBeNull()
  })

  it("nests one collection's documents under its own index, not another collection's", () => {
    const result = planFolders(
      [
        { path: 'docs/a/README.md', collection: OTHER },
        { path: 'docs/a/b.md', collection: GUIDE },
      ],
      [
        { collection: OTHER, root: 'docs' },
        { collection: GUIDE, root: 'docs' },
      ],
    )
    expect(result.parents.get('docs/a/b.md')).toBeNull()
    expect(result.generated.size).toBe(0)
  })
})

describe('withFolderAddresses', () => {
  const tenancy = documentId('00000000-0000-4000-8000-000000000001')
  const index = documentId('00000000-0000-4000-8000-000000000002')
  const concepts = documentId('00000000-0000-4000-8000-000000000003')
  const file = documentId('00000000-0000-4000-8000-000000000004')

  it("addresses each folder by its document, an index before a README, and a file's own path first", () => {
    const addressed = withFolderAddresses(
      new Map([
        ['guide/concepts/tenancy/README.md', tenancy],
        ['guide/a/README.md', tenancy],
        ['guide/a/index.md', index],
        [generatedFolderPath('guide/concepts'), concepts],
        ['guide/b', file],
        ['guide/b/README.md', tenancy],
      ]),
    )
    expect(addressed.get('guide/concepts/tenancy')).toBe(tenancy)
    expect(addressed.get('guide/a')).toBe(index)
    expect(addressed.get('guide/concepts')).toBe(concepts)
    expect(addressed.get('guide/b')).toBe(file)
  })

  it('answers the same map when no document stands for a folder', () => {
    const documents = new Map([['guide/a.md', file]])
    expect(withFolderAddresses(documents)).toBe(documents)
  })
})
