import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LINK_SETTINGS,
  cleanedLinkSettings,
  linkSettingsOf,
  patternProblems,
  withLinkSettings,
} from './link-settings-model.ts'
import { organisationSettings } from './settings-fixtures.ts'

describe('the link settings of an organisation', () => {
  it('are the shipped defaults for a document that has none', () => {
    expect(linkSettingsOf(organisationSettings())).toEqual(DEFAULT_LINK_SETTINGS)
    expect(DEFAULT_LINK_SETTINGS).toEqual({
      mode: 'rich',
      publicSite: true,
      defaultDisplay: 'inline',
      allow: [],
      block: [],
    })
  })

  it('are what the document says once it has some', () => {
    const saved = { ...DEFAULT_LINK_SETTINGS, mode: 'text' as const, block: ['ads.example'] }
    expect(linkSettingsOf(organisationSettings({ linkPreviews: saved }))).toEqual(saved)
  })

  it('go back into the document without disturbing the rest of it', () => {
    const before = organisationSettings()
    const after = withLinkSettings(before, { ...DEFAULT_LINK_SETTINGS, mode: 'off' })
    expect(after.linkPreviews?.mode).toBe('off')
    expect(after.name).toBe(before.name)
    expect(after.theme).toBe(before.theme)
  })
})

describe('the problems with a list of patterns', () => {
  it('are none for a list of good ones, blank lines and surrounding space included', () => {
    expect(patternProblems(['docs.example.com', '', '  *.example.org/internal/*  '])).toEqual([])
  })

  it('name the line, the pattern and the reason, counting lines from one', () => {
    const problems = patternProblems(['fine.example', 'not a host', '', 'a.com/x*y'])
    expect(problems).toEqual([
      { line: 2, pattern: 'not a host', message: expect.stringMatching(/host/u) },
      { line: 4, pattern: 'a.com/x*y', message: expect.stringMatching(/path/u) },
    ])
  })

  it('accept every spelling the server accepts', () => {
    for (const good of ['example.com', '*.example.com', 'example.com/docs', 'https://example.com'])
      expect(patternProblems([good])).toEqual([])
  })
})

describe('cleaning the settings before they are saved', () => {
  it('trims patterns, drops blank lines and repeats, and keeps the order', () => {
    expect(
      cleanedLinkSettings({
        ...DEFAULT_LINK_SETTINGS,
        allow: ['  a.example ', '', 'b.example', 'A.example'],
        block: ['', 'x.example'],
      }),
    ).toEqual({ ...DEFAULT_LINK_SETTINGS, allow: ['a.example', 'b.example'], block: ['x.example'] })
  })
})
