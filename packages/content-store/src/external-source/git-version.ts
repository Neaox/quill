import { ExternalSourceError } from '@quill/application'

/**
 * The oldest `git` the external source adapter runs with: 2.49 added `git
 * backfill`, which fetches the blobs under the source's paths and no others
 * (ADR-061).
 */
export const MINIMUM_GIT_VERSION = { major: 2, minor: 49 } as const

export interface GitVersion {
  readonly major: number
  readonly minor: number
  /** As `git --version` printed it, platform suffix and all. */
  readonly text: string
}

/** `git version 2.56.0.windows.2`, `git version 2.39.5 (Apple Git-154)`, and the like. */
export function parseGitVersion(output: string): GitVersion | null {
  const match = /^git version (\d+)\.(\d+)/u.exec(output.trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), text: output.trim() }
}

/** The version, or a refusal that says which version is needed and which was found. */
export function supportedGitVersion(output: string): GitVersion {
  const version = parseGitVersion(output)
  if (version === null) {
    throw new ExternalSourceError(
      'git-unavailable',
      `The git executable did not report a version (it printed "${output.trim().slice(0, 200)}").`,
    )
  }
  const { major, minor } = MINIMUM_GIT_VERSION
  if (version.major < major || (version.major === major && version.minor < minor)) {
    throw new ExternalSourceError(
      'git-too-old',
      `Reading an external source needs git ${major}.${minor} or later for "git backfill"; ` +
        `this instance has ${version.text}.`,
    )
  }
  return version
}
