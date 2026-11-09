import { describe, expect, it } from 'vitest'

import type { WorkspaceSourceDto } from '../../lib/api/index.ts'
import {
  EMPTY_FORM,
  describeUnreadable,
  draftBody,
  draftKey,
  formFromSource,
  missingFields,
  nameFromPath,
  settingsBody,
} from './source-form-model.ts'

const SAVED: WorkspaceSourceDto = {
  remote: 'https://github.com/acme/handbook.git',
  branch: 'main',
  collections: [{ collectionId: 'c-1', slug: 'guides', name: 'Guides', path: 'docs/guides' }],
  history: 'head',
  commitMessages: 'none',
  manifestEntry: null,
  credential: { username: 'x-access-token', secretName: 'sources/handbook' },
  outsideLinks: 'text',
  viewTemplate: 'https://git.example.com/{commit}/{path}',
  webhookSecret: 'sources/hook',
  updatedAt: '2026-11-09T08:00:00.000Z',
  sync: null,
  syncing: false,
}

describe('the repository form', () => {
  it('asks a preview what it would read, trimmed, with a saved collection keeping its slug', () => {
    const form = {
      ...formFromSource(SAVED),
      remote: ' https://github.com/acme/handbook.git ',
      collections: [
        { key: 'c-1', slug: 'guides', name: 'How-to guides', path: 'docs/guides ' },
        { key: 'new-0', slug: null, name: 'Decision records', path: 'docs/adr' },
      ],
    }
    expect(draftBody(form)).toEqual({
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      credential: { username: 'x-access-token', secretName: 'sources/handbook' },
      collections: [
        { slug: 'guides', name: 'How-to guides', path: 'docs/guides' },
        { slug: 'decision-records', name: 'Decision records', path: 'docs/adr' },
      ],
      manifestEntry: null,
    })
  })

  it('saves what it previewed, sending back what it does not show and keeping the webhook', () => {
    const body = settingsBody(formFromSource(SAVED), SAVED)
    expect(body).toMatchObject({
      history: 'head',
      commitMessages: 'none',
      outsideLinks: 'text',
      viewTemplate: 'https://git.example.com/{commit}/{path}',
    })
    expect(body).not.toHaveProperty('webhookSecret')
    expect(settingsBody(EMPTY_FORM, null)).not.toHaveProperty('outsideLinks')
  })

  it('tells two drafts apart by what they would read', () => {
    const form = formFromSource(SAVED)
    expect(draftKey(draftBody(form))).toBe(draftKey(draftBody({ ...form })))
    expect(draftKey(draftBody(form))).not.toBe(
      draftKey(draftBody({ ...form, manifestEntry: 'public' })),
    )
  })

  it('names what is missing before anything is asked', () => {
    expect(missingFields(EMPTY_FORM)).toEqual({ remote: 'Enter the repository’s address.' })
    expect(
      missingFields({
        ...EMPTY_FORM,
        remote: 'https://x.example/r.git',
        branch: ' ',
        credential: { kind: 'secret', username: '', secretName: 'sources/x' },
        collections: [{ key: 'a', slug: null, name: '', path: 'docs' }],
      }),
    ).toEqual({
      branch: 'Enter the branch to read.',
      credential: 'Enter the user name the token is sent with.',
      collections: 'Give every collection a name and a path, or remove it.',
    })
  })

  it.each([
    ['branch-not-found', 'branch'],
    ['credential-refused', 'credential'],
    ['credential-unavailable', 'credential'],
    ['unreachable', 'remote'],
    ['blocked-by-outbound-policy', 'remote'],
    ['remote-not-allowed', 'remote'],
    ['invalid-path', 'collections'],
    ['timeout', null],
    ['output-too-large', null],
    ['git-too-old', null],
    ['command-failed', null],
  ])('says why a repository could not be read (%s) beside %s', (reason, field) => {
    const said = describeUnreadable(reason, 'mian')
    expect(said.field).toBe(field)
    expect(said.message.length).toBeGreaterThan(10)
  })

  it('suggests a collection’s name from its path', () => {
    expect(nameFromPath('docs/user_guide/')).toBe('User guide')
    expect(nameFromPath('CHANGELOG.md')).toBe('CHANGELOG')
    expect(nameFromPath('')).toBe('')
  })
})
