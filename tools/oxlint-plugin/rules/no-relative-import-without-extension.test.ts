import { describe, expect, it } from 'vitest'
import {
  copyFixtureGroup,
  fixtureFiles,
  readFixedFile,
  runRule,
} from '../test-support/run-oxlint.ts'

describe('quill/no-relative-import-without-extension', () => {
  it('accepts a relative import that already carries its extension', () => {
    const result = runRule(
      'no-relative-import-without-extension',
      fixtureFiles('no-relative-import-without-extension', 'valid'),
    )
    expect(result.diagnostics).toEqual([])
  })

  it('flags a relative import with no extension', () => {
    const result = runRule(
      'no-relative-import-without-extension',
      fixtureFiles('no-relative-import-without-extension', 'invalid'),
    )
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(1)
  })

  it('auto-fixes by appending the extension of the file that exists on disk', () => {
    const { targetPath } = copyFixtureGroup(
      'no-relative-import-without-extension',
      'invalid',
      'bad.ts',
    )
    runRule('no-relative-import-without-extension', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      "import { helper } from './helper.ts'\n\nexport { helper }\n",
    )
  })
})
