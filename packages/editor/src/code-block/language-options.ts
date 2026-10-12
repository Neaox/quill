import {
  CODE_LANGUAGES,
  LANGUAGE_CATEGORIES,
  languageForFile,
  resolveCodeLanguage,
} from '@quill/highlight/languages'
import type { RegisteredLanguage } from '@quill/highlight/languages'

import type { MatchRange } from '../slash/slash-rank.ts'

/**
 * What the language picker offers for what has been typed: pure, so the
 * search is tested without a picker, and read from the one language registry
 * (`@quill/highlight/languages`), so it offers exactly what the reader colours.
 */

/** A block with no language: written as a bare fence, read as plain monospace. */
export const PLAIN_TEXT = { value: '', label: 'Plain text' } as const

/** A fence name typed into the picker: the shape every grammar key and file extension has. */
const FENCE_NAME = /^[A-Za-z0-9][\w+#.-]{0,31}$/u

/** The words that mean plain text, beside its own label. */
const PLAIN_WORDS = ['plain', 'plaintext', 'text', 'txt', 'none']

/** A fence name or extension a language was found by, and which of its characters matched. */
export interface MatchedName {
  readonly text: string
  readonly match: MatchRange
}

export interface LanguageOption {
  /** `language:<id>`, `recent:<id>`, `plain`, or `fence:<as typed>`. */
  readonly id: string
  readonly label: string
  /** The characters of the label the query matched, when it matched the label. */
  readonly labelMatch?: MatchRange
  /**
   * The fence name or extension the query matched instead of the label, shown
   * quietly beside it ("Bash · zsh") so the canonical name is learned.
   */
  readonly via?: MatchedName
  readonly detail?: string
}

export interface LanguageOptionGroup {
  readonly id: string
  readonly label: string
  readonly options: readonly LanguageOption[]
}

/** How many recently used languages lead the list. */
export const RECENT_SHOWN = 4

/**
 * How well a language matches, best first: a name it is called exactly, its
 * label's start, a fence name's start, an extension's start, and anywhere in
 * its label.
 */
const TIER = { exact: 0, labelPrefix: 1, namePrefix: 2, extension: 3, labelContains: 4 } as const

interface Ranked {
  readonly language: RegisteredLanguage
  readonly tier: number
  readonly option: LanguageOption
}

const prefix = (text: string, length: number): MatchedName => ({
  text,
  match: { start: 0, end: length },
})

/** The fence names a language answers to besides its label, the canonical id first. */
function namesOf(language: RegisteredLanguage): readonly string[] {
  return [language.id, ...language.aliases].filter((name) => name !== language.label.toLowerCase())
}

/** How `lower` matches `language`, or undefined when it does not. */
function rank(language: RegisteredLanguage, lower: string, typed: string): Ranked | undefined {
  const label = language.label.toLowerCase()
  const option = (tier: number, extra: Partial<LanguageOption>): Ranked => ({
    language,
    tier,
    option: { id: `language:${language.id}`, label: language.label, ...extra },
  })
  const extension = lower.replace(/^\./u, '')
  const exactName = namesOf(language).find((name) => name === lower)
  if (label === lower) return option(TIER.exact, { labelMatch: { start: 0, end: label.length } })
  if (exactName !== undefined) return option(TIER.exact, { via: prefix(exactName, lower.length) })
  if (languageForFile(typed) === language || language.extensions.includes(extension)) {
    const known = language.extensions.find((name) => name === extension)
    return option(TIER.exact, known === undefined ? {} : { via: prefix(`.${known}`, lower.length) })
  }
  if (label.startsWith(lower))
    return option(TIER.labelPrefix, { labelMatch: { start: 0, end: lower.length } })
  const namePrefix = namesOf(language).find((name) => name.startsWith(lower))
  if (namePrefix !== undefined)
    return option(TIER.namePrefix, { via: prefix(namePrefix, lower.length) })
  const extensionPrefix = language.extensions.find((name) => name.startsWith(extension))
  if (extensionPrefix !== undefined) {
    return option(TIER.extension, { via: prefix(`.${extensionPrefix}`, extension.length + 1) })
  }
  const at = label.indexOf(lower)
  return at === -1
    ? undefined
    : option(TIER.labelContains, { labelMatch: { start: at, end: at + lower.length } })
}

/** Ranked languages grouped by category, the group holding the best match first. */
function byCategory(ranked: readonly Ranked[]): LanguageOptionGroup[] {
  const grouped = Object.groupBy(ranked, (entry) => entry.language.category)
  return LANGUAGE_CATEGORIES.flatMap((category, order) => {
    const members = (grouped[category] ?? []).toSorted((a, b) => a.tier - b.tier)
    const best = members[0]
    return best === undefined
      ? []
      : [
          {
            group: {
              id: category.toLowerCase(),
              label: category,
              options: members.map((entry) => entry.option),
            },
            tier: best.tier,
            order,
          },
        ]
  })
    .toSorted((a, b) => a.tier - b.tier || a.order - b.order)
    .map(({ group }) => group)
}

const PLAIN_GROUP: LanguageOptionGroup = {
  id: 'plain',
  label: 'No language',
  options: [{ id: 'plain', label: PLAIN_TEXT.label }],
}

const unranked = (language: RegisteredLanguage): Ranked => ({
  language,
  tier: 0,
  option: { id: `language:${language.id}`, label: language.label },
})

/**
 * What to offer for `query`, given the ids of the languages used most
 * recently. With nothing typed: plain text, the recent ones, then every
 * language by category. With something typed: plain text when it is asked
 * for, then every language it matches, ranked (`TIER`), grouped by category
 * with the best group first, each saying which fence name or extension it was
 * found by; and — when it names nothing known but reads as a fence name — the
 * name itself, kept as written (AGENTS.md rule 7).
 */
export function languageOptions(query: string, recent: readonly string[]): LanguageOptionGroup[] {
  const typed = query.trim()
  if (typed === '') {
    const used = recent
      .map((id) => resolveCodeLanguage(id))
      .filter((language) => language !== undefined)
      .slice(0, RECENT_SHOWN)
    // Plain text leads, so emptying the field and pressing Enter means what it says.
    return [
      PLAIN_GROUP,
      ...(used.length === 0
        ? []
        : [
            {
              id: 'recent',
              label: 'Recent',
              options: used.map((one) => ({ id: `recent:${one.id}`, label: one.label })),
            },
          ]),
      ...byCategory(CODE_LANGUAGES.map(unranked)),
    ]
  }

  const lower = typed.toLowerCase()
  const ranked = CODE_LANGUAGES.flatMap((language) => rank(language, lower, typed) ?? [])
  const plain =
    PLAIN_WORDS.some((word) => word.startsWith(lower)) ||
    PLAIN_TEXT.label.toLowerCase().startsWith(lower)
  const asWritten = ranked.length === 0 && !plain && FENCE_NAME.test(typed)
  return [
    ...(plain ? [PLAIN_GROUP] : []),
    ...byCategory(ranked),
    ...(asWritten
      ? [
          {
            id: 'fence',
            label: 'As written',
            options: [
              {
                id: `fence:${typed}`,
                label: typed,
                detail: 'Kept as written, shown as plain text',
              },
            ],
          },
        ]
      : []),
  ]
}

/** The fence name an option writes onto a block: an id, nothing for plain text, or the name as typed. */
export function fenceNameOf(optionId: string): string | null | undefined {
  if (optionId === 'plain') return null
  const [kind, ...name] = optionId.split(':')
  const written = name.join(':')
  return kind === 'language' || kind === 'recent' || kind === 'fence' ? written : undefined
}

/**
 * Whether choosing `chosen` changes a block fenced `current`. Choosing the
 * language a block is already in never rewrites its fence: a block written
 * ```` ```sh ```` stays `sh`, though the picker calls it Bash. Only a different
 * language is written, by the registry's canonical fence name.
 */
export function changesLanguage(current: unknown, chosen: string | null): boolean {
  const fence = typeof current === 'string' && current !== '' ? current : null
  if (fence === chosen) return false
  if (fence === null || chosen === null) return true
  const known = resolveCodeLanguage(fence)
  return known === undefined || known !== resolveCodeLanguage(chosen)
}

/** What a reader calls a block's language: its name, the fence as written, or nothing. */
export function languageName(language: unknown): string | undefined {
  if (typeof language !== 'string' || language === '') return undefined
  return resolveCodeLanguage(language)?.label ?? language
}
