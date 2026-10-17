import type { UserId } from '@quill/domain'
import { type Static, Type } from '@sinclair/typebox'
import { omit } from 'remeda'

import type { UnitOfWork } from '../ports/persistence.ts'
import type { Clock } from '../ports/system.ts'
import { createVersionedReader, type VersionedReader } from './versioned-reader.ts'

/**
 * A person's own preferences (ADR-034: per-person data lives in Postgres).
 *
 * Stored as one versioned document per person (ADR-033), every field
 * optional, so adding a preference is adding a field and never a migration
 * of anyone's stored document: a field the document leaves out is the
 * default. The first preference is how animated images play (ADR-047,
 * "Animation: brief, stoppable, and never for those who ask for none").
 */

/**
 * How animated images play for this person: briefly and then still (the
 * default), only while pointed at, or never. Whatever this says, a person
 * whose system asks for reduced motion always sees a still (ADR-047).
 */
export const AnimatedImagePreferenceSchema = Type.Union([
  Type.Literal('brief'),
  Type.Literal('hover'),
  Type.Literal('never'),
])

export type AnimatedImagePreference = Static<typeof AnimatedImagePreferenceSchema>

/** Every value the schema allows, in the order a control offers them. */
export const ANIMATED_IMAGE_PREFERENCES = [
  'brief',
  'hover',
  'never',
] as const satisfies readonly AnimatedImagePreference[]

export function isAnimatedImagePreference(value: unknown): value is AnimatedImagePreference {
  return ANIMATED_IMAGE_PREFERENCES.some((preference) => preference === value)
}

/** The version of the stored document this release writes. */
export const PERSON_PREFERENCES_VERSION = 1

/** What a person may set: every preference optional, absent meaning the default. */
export const PersonPreferencesInputSchema = Type.Object(
  { animatedImages: Type.Optional(AnimatedImagePreferenceSchema) },
  { additionalProperties: false },
)

export type PersonPreferencesInput = Static<typeof PersonPreferencesInputSchema>

/** The effective preferences: what the person chose, with every default filled in. */
export const PersonPreferencesSchema = Type.Object(
  { animatedImages: AnimatedImagePreferenceSchema },
  { additionalProperties: false },
)

export type PersonPreferences = Static<typeof PersonPreferencesSchema>

export const DEFAULT_PERSON_PREFERENCES: PersonPreferences = { animatedImages: 'brief' }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Version 1. A value no release writes degrades to the default rather than
 * making the whole document unreadable: one bad field should not cost a
 * person every other preference.
 */
function readVersion1(value: unknown): PersonPreferences | null {
  if (!isRecord(value)) return null
  const { animatedImages } = value
  return {
    animatedImages: isAnimatedImagePreference(animatedImages)
      ? animatedImages
      : DEFAULT_PERSON_PREFERENCES.animatedImages,
  }
}

export const personPreferencesReader: VersionedReader<PersonPreferences> = createVersionedReader({
  1: readVersion1,
})

export interface PersonPreferencesDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
}

/** The person's effective preferences; the defaults when none are stored or this release cannot read them. */
export async function readPersonPreferences(
  deps: Pick<PersonPreferencesDependencies, 'uow'>,
  userId: UserId,
): Promise<PersonPreferences> {
  const row = await deps.uow.repos.personPreferences.find(userId)
  return (
    (row === null ? null : personPreferencesReader.read(row.document)) ?? DEFAULT_PERSON_PREFERENCES
  )
}

export interface UpdatePersonPreferencesCommand {
  readonly userId: UserId
  /** The whole set this release knows; a preference left out returns to its default. */
  readonly preferences: PersonPreferencesInput
}

/**
 * Replaces the preferences this release knows, keeping any field of the same
 * version it does not: a newer release may have added one (additive, ADR-033),
 * and saving from an older tab must not erase it. A document of another
 * version is replaced outright, since this release cannot know what its
 * fields mean.
 */
export async function updatePersonPreferences(
  deps: PersonPreferencesDependencies,
  { userId, preferences }: UpdatePersonPreferencesCommand,
): Promise<PersonPreferences> {
  return deps.uow.run(async (repos) => {
    const stored = (await repos.personPreferences.find(userId))?.document
    const kept =
      isRecord(stored) && stored['version'] === PERSON_PREFERENCES_VERSION
        ? omit(stored, ['version', 'animatedImages'])
        : {}
    const document = {
      ...kept,
      version: PERSON_PREFERENCES_VERSION,
      ...(preferences.animatedImages === undefined
        ? {}
        : { animatedImages: preferences.animatedImages }),
    }
    await repos.personPreferences.put({ userId, document, now: deps.clock.now() })
    return { ...DEFAULT_PERSON_PREFERENCES, ...preferences }
  })
}
