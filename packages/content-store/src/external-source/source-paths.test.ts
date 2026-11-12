import { err, ok } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { sourcePrefixes, sparsePatterns } from './source-paths.ts'

const loose = { strict: false }
const strict = { strict: true }

describe('sourcePrefixes', () => {
  it('keeps literal directories and files, without a trailing slash', () => {
    expect(sourcePrefixes(['docs/guides/', 'README.md'], strict)).toEqual(
      ok(['README.md', 'docs/guides']),
    )
  })

  it('widens a glob to its longest literal directory', () => {
    expect(
      sourcePrefixes(['packages/**/README.md', 'docs/adr/*.md', 'docs/[ab].md'], loose),
    ).toEqual(ok(['docs', 'packages']))
  })

  it('drops duplicates and prefixes another prefix already holds', () => {
    expect(sourcePrefixes(['docs/guides', 'docs', 'docs', 'docsite/a.md'], loose)).toEqual(
      ok(['docs', 'docsite/a.md']),
    )
  })

  it('refuses a glob when strict', () => {
    expect(sourcePrefixes(['docs/*.md'], strict)).toEqual(
      err('"docs/*.md" is a glob, and this source accepts only literal paths.'),
    )
  })

  it('widens a brace group to the directory in front of it, and refuses it when strict', () => {
    expect(sourcePrefixes(['docs/{guide,notes}.md', 'packages/{a,b}/README.md'], loose)).toEqual(
      ok(['docs', 'packages']),
    )
    expect(sourcePrefixes(['docs/{guide,notes}.md'], strict)).toEqual(
      err('"docs/{guide,notes}.md" is a glob, and this source accepts only literal paths.'),
    )
  })

  it('refuses a glob with no directory to widen to, which would be the whole repository', () => {
    expect(sourcePrefixes(['docs', '{a,b}/x.md'], loose).ok).toBe(false)
  })

  it.each(['', '/docs', 'docs//guides', './docs', 'docs/../secret', 'docs\\guides', 'a\0b'])(
    'refuses %j',
    (path) => {
      expect(sourcePrefixes([path], loose).ok).toBe(false)
    },
  )

  it('refuses no paths at all', () => {
    expect(sourcePrefixes([], loose)).toEqual(err('A source needs at least one path.'))
  })
})

describe('sparsePatterns', () => {
  it('anchors each prefix as a file and as a directory', () => {
    expect(sparsePatterns(['docs/guides', 'README.md'])).toEqual([
      '/docs/guides',
      '/docs/guides/**',
      '/README.md',
      '/README.md/**',
    ])
  })

  it('escapes spaces, which a pattern would otherwise trim', () => {
    expect(sparsePatterns(['my docs '])).toEqual(['/my\\ docs\\ ', '/my\\ docs\\ /**'])
  })
})
