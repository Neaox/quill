import { describe, expect, it } from 'vitest'

import {
  defaultOrganisationSettings,
  parseOrganisationSettings,
  validateOrganisationSettings,
} from './documents.ts'
import {
  DEFAULT_LINK_PREVIEW_SETTINGS,
  linkPolicyOf,
  resolveLinkPreviewSettings,
} from './link-previews.ts'
import type { LinkPreviewSettings } from './link-previews.ts'

const withLinks = (linkPreviews: unknown) => ({ ...defaultOrganisationSettings(), linkPreviews })

const issuesOf = (linkPreviews: unknown) => {
  const result = validateOrganisationSettings(withLinks(linkPreviews))
  return result.valid ? [] : result.issues
}

const GOOD: LinkPreviewSettings = {
  mode: 'text',
  publicSite: false,
  defaultDisplay: 'card',
  allow: ['docs.example.com'],
  block: ['*.tracker.example/ads'],
}

describe('link preview settings in the organisation’s document (ADR-042)', () => {
  it('are optional, so a file written before them reads exactly as it did', () => {
    const before = defaultOrganisationSettings()
    expect('linkPreviews' in before).toBe(false)
    expect(validateOrganisationSettings(before).valid).toBe(true)
    expect(parseOrganisationSettings(before)).toEqual(before)
  })

  it('default to the richest, most open behaviour when absent', () => {
    expect(resolveLinkPreviewSettings(defaultOrganisationSettings())).toEqual({
      mode: 'rich',
      publicSite: true,
      defaultDisplay: 'inline',
      allow: [],
      block: [],
    })
    expect(DEFAULT_LINK_PREVIEW_SETTINGS.defaultDisplay).toBe('inline')
  })

  it('round-trip through the validator and the versioned reader', () => {
    expect(validateOrganisationSettings(withLinks(GOOD)).valid).toBe(true)
    const read = parseOrganisationSettings(withLinks(GOOD))
    expect(read && resolveLinkPreviewSettings(read)).toEqual(GOOD)
  })

  it('refuse a mode or a default display they do not know, and embed as a blanket default', () => {
    expect(issuesOf({ ...GOOD, mode: 'loud' }).map((issue) => issue.path)).toContain(
      '/linkPreviews/mode',
    )
    expect(issuesOf({ ...GOOD, defaultDisplay: 'embed' }).map((issue) => issue.path)).toContain(
      '/linkPreviews/defaultDisplay',
    )
  })

  it('refuse a field this release does not know instead of dropping it', () => {
    expect(issuesOf({ ...GOOD, tracking: true })).not.toEqual([])
  })

  it('refuse an invalid pattern, naming the list, the position and the reason', () => {
    const issues = issuesOf({ ...GOOD, allow: ['ok.example', 'not a host'], block: ['a.com/x*y'] })
    expect(issues.map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: '/linkPreviews/allow/1', rule: 'link-pattern' },
      { path: '/linkPreviews/block/0', rule: 'link-pattern' },
    ])
    expect(issues[0]?.message).toContain('not a host')
    expect(issues[0]?.message).toMatch(/host/u)
    expect(issues[1]?.message).toMatch(/path/u)
  })

  it('refuse more patterns than a policy may hold', () => {
    const many = Array.from({ length: 501 }, (_, index) => `h${index}.example`)
    expect(issuesOf({ ...GOOD, block: many })).not.toEqual([])
  })
})

describe('the policy an organisation’s settings make', () => {
  it('is the mode and the lists, and nothing else', () => {
    expect(linkPolicyOf(GOOD)).toEqual({
      mode: 'text',
      allow: ['docs.example.com'],
      block: ['*.tracker.example/ads'],
    })
  })
})
