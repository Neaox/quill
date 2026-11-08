import { describe, expect, it } from 'vitest'

import { decodeUtf8, isDocumentPath, titleFromPath } from './source-files.ts'

describe('isDocumentPath', () => {
  it('takes Markdown files, in either spelling and any case', () => {
    expect(isDocumentPath('docs/a.md')).toBe(true)
    expect(isDocumentPath('docs/A.MARKDOWN')).toBe(true)
    expect(isDocumentPath('docs/a.mdx')).toBe(false)
    expect(isDocumentPath('docs/md')).toBe(false)
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
