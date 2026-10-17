import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

function throughTheEditor(markdown: string): string {
  const { doc } = mdastToProseMirror(parseDocument(markdown).ast)
  return serializeDocument({ frontMatter: {}, ast: proseMirrorToMdast(doc).tree })
}

describe('a container directive with nothing in it', () => {
  it('opens, holding an empty line, and is written back as it was', () => {
    expect(throughTheEditor(':::callout{type="note"}\n:::\n')).toBe(
      ':::callout{type="note"}\n:::\n',
    )
  })

  it('opens when it was written with a blank line inside, as an emptied one is', () => {
    expect(throughTheEditor(':::notes\n\n:::\n')).toBe(':::notes\n:::\n')
  })
})
