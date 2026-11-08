import { describe, expect, it } from 'vitest'

import { collectionFor, decodeUtf8, isDocumentPath, titleFromPath } from './source-files.ts'

describe('isDocumentPath', () => {
  it('takes Markdown files, in either spelling and any case', () => {
    expect(isDocumentPath('docs/a.md')).toBe(true)
    expect(isDocumentPath('docs/A.MARKDOWN')).toBe(true)
    expect(isDocumentPath('docs/a.mdx')).toBe(false)
    expect(isDocumentPath('docs/md')).toBe(false)
  })
})

describe('collectionFor', () => {
  const docs = { collectionId: 'docs', path: './docs/' }
  const adr = { collectionId: 'adr', path: 'docs/adr' }
  const readme = { collectionId: 'readme', path: 'README.md' }

  it('picks the collection with the longest path the file lies under', () => {
    expect(collectionFor('docs/adr/1.md', [docs, adr])).toBe(adr)
    expect(collectionFor('docs/adr/1.md', [adr, docs])).toBe(adr)
    expect(collectionFor('docs/guide.md', [docs, adr])).toBe(docs)
  })

  it('matches a collection that is one file, and never a sibling sharing a prefix', () => {
    expect(collectionFor('README.md', [readme])).toBe(readme)
    expect(collectionFor('docs-old/a.md', [docs])).toBeNull()
  })

  it('lets a collection at the root read every file', () => {
    const root = { collectionId: 'root', path: '' }
    expect(collectionFor('anything/at/all.md', [root])).toBe(root)
    expect(collectionFor('docs/a.md', [root, docs])).toBe(docs)
  })
})

describe('titleFromPath', () => {
  it('humanises the file name', () => {
    expect(titleFromPath('docs/getting-started_now.md')).toBe('Getting started now')
    expect(titleFromPath('setup.md')).toBe('Setup')
  })

  it('names a folder document after its folder', () => {
    expect(titleFromPath('docs/release-notes/index.md')).toBe('Release notes')
    expect(titleFromPath('docs/tools/README.md')).toBe('Tools')
    expect(titleFromPath('README.md')).toBe('README')
  })

  it('calls a file with no name Untitled', () => {
    expect(titleFromPath('docs/--.md')).toBe('Untitled')
  })
})

describe('decodeUtf8', () => {
  it('reads UTF-8 and refuses anything else', () => {
    expect(decodeUtf8(new TextEncoder().encode('Café'))).toBe('Café')
    expect(decodeUtf8(new Uint8Array([0xff, 0xfe]))).toBeNull()
  })
})
