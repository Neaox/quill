import { type Static, Type } from '@sinclair/typebox'

import {
  LINK_PREVIEW_MODES,
  MAX_POLICY_PATTERNS,
  ORGANISATION_DEFAULT_DISPLAYS,
  describePatternError,
  parseUrlPattern,
} from '@quill/domain'
import type { LinkPreviewPolicy } from '@quill/domain'

/**
 * What an organisation lets Quill do about links (ADR-042, "Policy"), as the
 * `linkPreviews` section of its settings document.
 *
 * Optional in the document, so every file written before it reads as it did
 * (AGENTS.md rule 17); an absent section means the shipped defaults below. The
 * fields inside are all required once the section exists, so a saved section
 * is always complete and a reader never guesses.
 */

const literals = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)))

/** A pattern is checked by the domain's parser, which a schema cannot express; its length is bounded here. */
const PatternListSchema = Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
  maxItems: MAX_POLICY_PATTERNS,
})

export const LinkPreviewSettingsSchema = Type.Object(
  {
    /** `off`: plain links only. `text`: no pictures fetched or shown. `rich`: everything. */
    mode: literals(LINK_PREVIEW_MODES),
    /** When off, the public site and share links draw plain links (ADR-042). */
    publicSite: Type.Boolean(),
    /** How a pasted or bare link looks when its author chose nothing. */
    defaultDisplay: literals(ORGANISATION_DEFAULT_DISPLAYS),
    /** When not empty, Quill contacts only matching sites. */
    allow: PatternListSchema,
    /** Quill never contacts matching sites. Wins over `allow`. */
    block: PatternListSchema,
  },
  { additionalProperties: false },
)

export type LinkPreviewSettings = Static<typeof LinkPreviewSettingsSchema>

export const DEFAULT_LINK_PREVIEW_SETTINGS: LinkPreviewSettings = {
  mode: 'rich',
  publicSite: true,
  defaultDisplay: 'inline',
  allow: [],
  block: [],
}

/** The settings in force: the section if the document has one, else the defaults. */
export function resolveLinkPreviewSettings(document: {
  readonly linkPreviews?: LinkPreviewSettings | undefined
}): LinkPreviewSettings {
  return document.linkPreviews ?? DEFAULT_LINK_PREVIEW_SETTINGS
}

/** The part of the settings that governs what Quill fetches; the rest is presentation. */
export function linkPolicyOf(settings: LinkPreviewSettings): LinkPreviewPolicy {
  return { mode: settings.mode, allow: settings.allow, block: settings.block }
}

export interface LinkPatternIssue {
  /** A JSON pointer to the pattern, such as `/linkPreviews/block/2`. */
  readonly path: string
  readonly message: string
  readonly rule: 'link-pattern'
}

/**
 * Every pattern the domain's parser refuses, with where it is and why. The
 * same parser the server enforces with, so a pattern that saves is a pattern
 * that works.
 */
export function linkPatternIssues(settings: LinkPreviewSettings): readonly LinkPatternIssue[] {
  return (['allow', 'block'] as const).flatMap((list) =>
    settings[list].flatMap((pattern, index): LinkPatternIssue[] => {
      const parsed = parseUrlPattern(pattern)
      if (parsed.ok) return []
      return [
        {
          path: `/linkPreviews/${list}/${index}`,
          message: `"${pattern}" is not a valid ${list} pattern. ${describePatternError(parsed.error)}`,
          rule: 'link-pattern',
        },
      ]
    }),
  )
}
