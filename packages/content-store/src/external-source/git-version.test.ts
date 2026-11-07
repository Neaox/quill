import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { parseGitVersion, supportedGitVersion } from './git-version.ts'

describe('parseGitVersion', () => {
  it.each([
    ['git version 2.56.0.windows.2\n', 2, 56],
    ['git version 2.39.5 (Apple Git-154)', 2, 39],
    ['git version 3.0.0', 3, 0],
  ])('reads %j', (output, major, minor) => {
    expect(parseGitVersion(output)).toMatchObject({ major, minor })
  })

  it('reads nothing from output that is not a version', () => {
    expect(parseGitVersion('usage: git [-v | --version]')).toBeNull()
  })
})

describe('supportedGitVersion', () => {
  it.each(['git version 2.49.0', 'git version 2.56.0.windows.2', 'git version 3.0.0'])(
    'accepts %j',
    (output) => {
      expect(supportedGitVersion(output).text).toBe(output)
    },
  )

  it.each(['git version 2.48.1', 'git version 1.99.0'])(
    'refuses %j, naming what is needed',
    (output) => {
      expect(() => supportedGitVersion(output)).toThrow(
        expect.objectContaining({
          reason: 'git-too-old',
          message: expect.stringContaining(
            `needs git 2.49 or later for "git backfill"; this instance has ${output}`,
          ),
        }),
      )
    },
  )

  it('refuses an executable that does not report a version', () => {
    expect(() => supportedGitVersion('hello')).toThrow(
      expect.objectContaining({ reason: 'git-unavailable' }),
    )
  })

  it('accepts the git on this machine, which every other external-source test relies on', () => {
    const output = execFileSync('git', ['--version'], { encoding: 'utf8' })

    expect(() => supportedGitVersion(output)).not.toThrow()
  })
})
