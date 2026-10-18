import { describePatternError, parseUrlPattern } from '@quill/domain'

import type { OrganisationSettings } from '../../lib/api/index.ts'

/**
 * The organisation's link settings as the screen handles them (ADR-042,
 * "Policy"): the `linkPreviews` section of its settings document, its defaults
 * when the document has none, and the checks a pattern list gets as it is
 * typed.
 *
 * The defaults are written out here as well as in `@quill/application` because
 * the web app reaches the server only through the generated client; the schema
 * holds the two together, and a test on each side pins the same values.
 */

export type LinkSettings = NonNullable<OrganisationSettings['linkPreviews']>

export const DEFAULT_LINK_SETTINGS: LinkSettings = {
  mode: 'rich',
  publicSite: true,
  defaultDisplay: 'inline',
  allow: [],
  block: [],
}

/** What is in force: the section if the document has one, else the defaults. */
export function linkSettingsOf(settings: OrganisationSettings): LinkSettings {
  return settings.linkPreviews ?? DEFAULT_LINK_SETTINGS
}

export function withLinkSettings(
  settings: OrganisationSettings,
  linkPreviews: LinkSettings,
): OrganisationSettings {
  return { ...settings, linkPreviews }
}

export interface PatternProblem {
  /** Counted from one, as a person counts lines. */
  readonly line: number
  readonly pattern: string
  readonly message: string
}

/**
 * Every pattern that would be refused, by the very parser the server enforces
 * with, so a list that shows no problem here is a list the server saves. Blank
 * lines are the space between patterns and are not problems.
 */
export function patternProblems(lines: readonly string[]): readonly PatternProblem[] {
  return lines.flatMap((pattern, index): PatternProblem[] => {
    if (pattern.trim() === '') return []
    const parsed = parseUrlPattern(pattern)
    return parsed.ok
      ? []
      : [{ line: index + 1, pattern: pattern.trim(), message: describePatternError(parsed.error) }]
  })
}

function cleanedList(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  return lines
    .map((line) => line.trim())
    .filter((line) => {
      const key = line.toLowerCase()
      if (line === '' || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * The settings in the shape that is saved. The draft keeps blank lines so a
 * person can press Enter to start a new pattern; the document never holds one.
 */
export function cleanedLinkSettings(settings: LinkSettings): LinkSettings {
  return { ...settings, allow: cleanedList(settings.allow), block: cleanedList(settings.block) }
}
