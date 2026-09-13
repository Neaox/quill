import { describe, expect, it } from 'vitest'

import { chooseFiles } from './files.ts'
import type { DroppedFile } from './files.ts'

function file(name: string, type: string, size = 1024): DroppedFile {
  return { name, type, size }
}

describe('chooseFiles', () => {
  it('takes the files when there are any', () => {
    const files = [file('diagram.png', 'image/png')]
    expect(chooseFiles({ files, inCode: false })).toStrictEqual({ kind: 'files', files })
  })

  it('takes every file of a multiple drop, in the order they arrived', () => {
    const files = [file('one.png', 'image/png'), file('two.pdf', 'application/pdf')]
    const action = chooseFiles({ files, inCode: false })

    expect(action.kind).toBe('files')
    if (action.kind !== 'files') return
    expect(action.files.map((each) => each.name)).toStrictEqual(['one.png', 'two.pdf'])
  })

  it('leaves a drop with no files to the browser', () => {
    expect(chooseFiles({ files: [], inCode: false })).toStrictEqual({ kind: 'default' })
  })

  it('leaves a code block alone: a drop there is text being moved', () => {
    const files = [file('diagram.png', 'image/png')]
    expect(chooseFiles({ files, inCode: true })).toStrictEqual({ kind: 'default' })
  })

  it('ignores an empty entry, which is what a dropped folder looks like', () => {
    const folder = file('screenshots', '', 0)
    expect(chooseFiles({ files: [folder], inCode: false })).toStrictEqual({ kind: 'default' })

    const picture = file('diagram.png', 'image/png')
    const action = chooseFiles({ files: [folder, picture], inCode: false })
    expect(action).toStrictEqual({ kind: 'files', files: [picture] })
  })

  it('takes a file whatever its type, because the server decides what is acceptable', () => {
    const anything = file('archive.zip', 'application/zip')
    expect(chooseFiles({ files: [anything], inCode: false })).toStrictEqual({
      kind: 'files',
      files: [anything],
    })
  })
})
