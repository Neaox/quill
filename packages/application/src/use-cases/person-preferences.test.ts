import type { UserId } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { createFakeClock } from '../test-support/fakes.ts'
import {
  createInMemoryUnitOfWork,
  type InMemoryUnitOfWork,
} from '../test-support/in-memory-repositories.ts'
import {
  ANIMATED_IMAGE_PREFERENCES,
  DEFAULT_PERSON_PREFERENCES,
  PERSON_PREFERENCES_VERSION,
  type PersonPreferencesDependencies,
  personPreferencesReader,
  readPersonPreferences,
  updatePersonPreferences,
} from './person-preferences.ts'

const PERSON = 'user-1' as UserId
const NOW = new Date('2026-10-11T00:00:00.000Z')

let uow: InMemoryUnitOfWork
let deps: PersonPreferencesDependencies

beforeEach(() => {
  uow = createInMemoryUnitOfWork()
  deps = { uow, clock: createFakeClock(NOW) }
})

const store = (document: unknown) =>
  uow.repos.personPreferences.put({ userId: PERSON, document, now: NOW })

describe('the animated images preference', () => {
  it('offers playing briefly, on hover only, or never', () => {
    expect(ANIMATED_IMAGE_PREFERENCES).toEqual(['brief', 'hover', 'never'])
  })

  it('plays briefly for anyone who has not chosen', () => {
    expect(DEFAULT_PERSON_PREFERENCES).toEqual({ animatedImages: 'brief' })
  })
})

describe('reading the stored document', () => {
  it('reads version 1', () => {
    expect(personPreferencesReader.read({ version: 1, animatedImages: 'never' })).toEqual({
      animatedImages: 'never',
    })
  })

  it('fills in the default for a preference version 1 left out', () => {
    expect(personPreferencesReader.read({ version: 1 })).toEqual({ animatedImages: 'brief' })
  })

  it('falls back to the default for a value nothing shipped writes', () => {
    expect(personPreferencesReader.read({ version: 1, animatedImages: 'sometimes' })).toEqual({
      animatedImages: 'brief',
    })
  })

  it('refuses a version 1 that is not a document', () => {
    expect(personPreferencesReader.read(Object.assign([], { version: 1 }))).toBeNull()
  })

  it('writes the current version', () => {
    expect(personPreferencesReader.current).toBe(PERSON_PREFERENCES_VERSION)
  })

  it('leaves a document a newer release wrote unread', () => {
    expect(personPreferencesReader.read({ version: 99, animatedImages: 'never' })).toBeNull()
  })
})

describe('readPersonPreferences', () => {
  it('is the defaults for someone who has never saved any', async () => {
    expect(await readPersonPreferences(deps, PERSON)).toEqual({ animatedImages: 'brief' })
  })

  it('is what the person saved', async () => {
    await store({ version: 1, animatedImages: 'hover' })
    expect(await readPersonPreferences(deps, PERSON)).toEqual({ animatedImages: 'hover' })
  })

  it('is the defaults when the stored document cannot be read by this release', async () => {
    await store({ version: 99, animatedImages: 'never' })
    expect(await readPersonPreferences(deps, PERSON)).toEqual({ animatedImages: 'brief' })
  })
})

describe('updatePersonPreferences', () => {
  it('stores a versioned document and returns the effective preferences', async () => {
    expect(
      await updatePersonPreferences(deps, {
        userId: PERSON,
        preferences: { animatedImages: 'never' },
      }),
    ).toEqual({ animatedImages: 'never' })
    expect(await uow.repos.personPreferences.find(PERSON)).toEqual({
      userId: PERSON,
      document: { version: 1, animatedImages: 'never' },
      updatedAt: NOW,
    })
  })

  it('returns to the default when a preference is left out', async () => {
    await store({ version: 1, animatedImages: 'never' })
    expect(await updatePersonPreferences(deps, { userId: PERSON, preferences: {} })).toEqual({
      animatedImages: 'brief',
    })
    expect((await uow.repos.personPreferences.find(PERSON))?.document).toEqual({ version: 1 })
  })

  /**
   * A newer release may add a field at the same version (additive, ADR-033);
   * an older one saving the fields it knows must not erase it.
   */
  it('keeps fields of the same version that this release does not know', async () => {
    await store({ version: 1, animatedImages: 'never', laterPreference: true })
    await updatePersonPreferences(deps, {
      userId: PERSON,
      preferences: { animatedImages: 'hover' },
    })
    expect((await uow.repos.personPreferences.find(PERSON))?.document).toEqual({
      version: 1,
      animatedImages: 'hover',
      laterPreference: true,
    })
  })

  it('starts afresh over a document of another version', async () => {
    await store({ version: 99, somethingElse: true })
    await updatePersonPreferences(deps, {
      userId: PERSON,
      preferences: { animatedImages: 'hover' },
    })
    expect((await uow.repos.personPreferences.find(PERSON))?.document).toEqual({
      version: 1,
      animatedImages: 'hover',
    })
  })
})
