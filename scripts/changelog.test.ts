import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkFragments,
  insertSection,
  parseFragment,
  release,
  renderSection,
} from './changelog.ts'

const UNRELEASED_CHANGELOG = `# Changelog

All notable changes are documented here.

## Unreleased

Pending changes live in \`.changelog/\`.
`

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'quill-changelog-'))
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeFragment(root: string, file: string, content: string): void {
  writeFileSync(join(root, '.changelog', file), content)
}

function setUpFragmentsDir(root: string): void {
  mkdirSync(join(root, '.changelog'), { recursive: true })
}

describe('parseFragment', () => {
  it('accepts a well-formed fragment with several entries', () => {
    const { fragment, issues } = parseFragment(
      '20260912-search.md',
      'Added: comment search\nFixed: broken table of contents\n',
    )
    expect(issues).toEqual([])
    expect(fragment).toEqual({
      file: '20260912-search.md',
      entries: [
        { category: 'Added', prose: 'comment search' },
        { category: 'Fixed', prose: 'broken table of contents' },
      ],
    })
  })

  it('ignores blank lines between entries', () => {
    const { fragment, issues } = parseFragment('20260912-search.md', 'Added: comment search\n\n\n')
    expect(issues).toEqual([])
    expect(fragment?.entries).toHaveLength(1)
  })

  it('rejects a filename that does not match the date-slug pattern', () => {
    const { fragment, issues } = parseFragment('search.md', 'Added: comment search\n')
    expect(fragment).toBeUndefined()
    expect(issues).toEqual([{ file: 'search.md', message: expect.stringContaining('filename') }])
  })

  it('rejects an empty fragment', () => {
    const { fragment, issues } = parseFragment('20260912-search.md', '\n  \n')
    expect(fragment).toBeUndefined()
    expect(issues).toEqual([
      { file: '20260912-search.md', message: expect.stringContaining('no entries') },
    ])
  })

  it('rejects a line with an unknown category', () => {
    const { fragment, issues } = parseFragment('20260912-search.md', 'Improved: comment search\n')
    expect(fragment).toBeUndefined()
    expect(issues).toEqual([
      { file: '20260912-search.md', message: expect.stringContaining('Improved: comment search') },
    ])
  })
})

describe('renderSection', () => {
  it('groups entries under fixed-order category headings, omitting empty categories', () => {
    const fragments = [
      {
        file: '20260910-a.md',
        entries: [
          { category: 'Fixed' as const, prose: 'first fix' },
          { category: 'Added' as const, prose: 'first add' },
        ],
      },
      { file: '20260911-b.md', entries: [{ category: 'Added' as const, prose: 'second add' }] },
    ]

    const section = renderSection('0.1.0', '2026-09-12', fragments)

    expect(section).toBe(
      [
        '## [0.1.0] - 2026-09-12',
        '',
        '### Added',
        '',
        '- first add',
        '- second add',
        '',
        '### Fixed',
        '',
        '- first fix',
        '',
      ].join('\n'),
    )
  })
})

describe('insertSection', () => {
  it('inserts the section directly below the Unreleased heading', () => {
    const result = insertSection(
      UNRELEASED_CHANGELOG,
      '## [0.1.0] - 2026-09-12\n\n### Added\n\n- x\n',
      '0.1.0',
    )
    expect(result).toContain(
      '## Unreleased\n\nPending changes live in `.changelog/`.\n\n## [0.1.0]',
    )
  })

  it('keeps an already-released section below a newly inserted one', () => {
    const withOldRelease = `${UNRELEASED_CHANGELOG}\n## [0.1.0] - 2026-09-01\n\n### Added\n\n- old\n`
    const result = insertSection(
      withOldRelease,
      '## [0.2.0] - 2026-09-12\n\n### Added\n\n- new\n',
      '0.2.0',
    )
    const olderIndex = result.indexOf('## [0.1.0]')
    const newerIndex = result.indexOf('## [0.2.0]')
    expect(newerIndex).toBeGreaterThan(-1)
    expect(olderIndex).toBeGreaterThan(newerIndex)
  })

  it('refuses to duplicate a version that already has a section', () => {
    const withRelease = `${UNRELEASED_CHANGELOG}\n## [0.1.0] - 2026-09-01\n\n### Added\n\n- old\n`
    expect(() => insertSection(withRelease, 'irrelevant', '0.1.0')).toThrow(
      /already has a "0.1.0" section/,
    )
  })

  it('refuses when there is no Unreleased heading to anchor on', () => {
    expect(() => insertSection('# Changelog\n', 'irrelevant', '0.1.0')).toThrow(
      /no "## Unreleased" heading/,
    )
  })
})

describe('checkFragments', () => {
  it('reports no issues for a directory of valid fragments', () => {
    withTempRoot((root) => {
      setUpFragmentsDir(root)
      writeFragment(root, '20260912-a.md', 'Added: a\n')
      expect(checkFragments(root)).toEqual([])
    })
  })

  it('never flags the format README itself', () => {
    withTempRoot((root) => {
      setUpFragmentsDir(root)
      writeFragment(root, 'README.md', 'not a fragment, just prose')
      expect(checkFragments(root)).toEqual([])
    })
  })

  it('returns an empty list when the fragments directory does not exist yet', () => {
    withTempRoot((root) => {
      expect(checkFragments(root)).toEqual([])
    })
  })
})

describe('release', () => {
  it('assembles fragments into CHANGELOG.md, grouped and in order, then deletes them', () => {
    withTempRoot((root) => {
      setUpFragmentsDir(root)
      writeFileSync(join(root, 'CHANGELOG.md'), UNRELEASED_CHANGELOG)
      writeFragment(root, '20260910-a.md', 'Fixed: first fix\nAdded: first add\n')
      writeFragment(root, '20260911-b.md', 'Added: second add\n')

      const result = release(root, '0.1.0', '2026-09-12')

      expect(result).toEqual({ changed: true, message: 'Released 0.1.0 with 2 fragment(s).' })
      const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
      expect(changelog).toContain('## [0.1.0] - 2026-09-12')
      expect(changelog.indexOf('- first add')).toBeLessThan(changelog.indexOf('- first fix'))
      expect(() => readFileSync(join(root, '.changelog', '20260910-a.md'), 'utf8')).toThrow(
        /ENOENT/,
      )
      expect(() => readFileSync(join(root, '.changelog', '20260911-b.md'), 'utf8')).toThrow(
        /ENOENT/,
      )
    })
  })

  it('is idempotent: releasing again with nothing left to collect changes nothing', () => {
    withTempRoot((root) => {
      setUpFragmentsDir(root)
      writeFileSync(join(root, 'CHANGELOG.md'), UNRELEASED_CHANGELOG)
      writeFragment(root, '20260910-a.md', 'Added: first add\n')

      release(root, '0.1.0', '2026-09-12')
      const afterFirst = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

      const second = release(root, '0.1.0', '2026-09-12')

      expect(second).toEqual({
        changed: false,
        message: 'No changelog fragments to release; nothing to do.',
      })
      expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(afterFirst)
    })
  })

  it('refuses to release when a fragment is malformed, and touches nothing', () => {
    withTempRoot((root) => {
      setUpFragmentsDir(root)
      writeFileSync(join(root, 'CHANGELOG.md'), UNRELEASED_CHANGELOG)
      writeFragment(root, 'bad-name.md', 'Added: first add\n')

      expect(() => release(root, '0.1.0', '2026-09-12')).toThrow(/filename must match/)
      expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(UNRELEASED_CHANGELOG)
    })
  })
})
