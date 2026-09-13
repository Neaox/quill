import { describe, expect, it } from 'vitest'
import {
  copyFixtureGroup,
  fixtureFiles,
  readFixedFile,
  runRule,
} from '../test-support/run-oxlint.ts'

describe('quill/tailwind-v4', () => {
  it('accepts canonical Tailwind 4 spellings', () => {
    const result = runRule('tailwind-v4', fixtureFiles('tailwind-v4', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags Tailwind 3 spellings in a className string', () => {
    const result = runRule('tailwind-v4', fixtureFiles('tailwind-v4', 'invalid'))
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2)
    expect(result.diagnostics.every((d) => d.line === 2)).toBe(true)
    const messages = result.diagnostics.map((d) => d.message).join('\n')
    expect(messages).toContain('shrink-* and grow-*')
    expect(messages).toContain('bare `rounded`')
  })

  it('auto-fixes the pure renames', () => {
    const { targetPath } = copyFixtureGroup('tailwind-v4', 'invalid', 'bad.tsx')
    runRule('tailwind-v4', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'export function Widget() {\n  return <div className="shrink-0 rounded">hi</div>\n}\n',
    )
  })
})
