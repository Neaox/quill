import { describe, expect, it } from 'vitest'

import { createShareLinkPolicy } from './share-link-policy.ts'

describe('createShareLinkPolicy', () => {
  it('answers what the configuration says', () => {
    expect(createShareLinkPolicy({ shareLinks: { enabled: true } }).allowed()).toBe(true)
    expect(createShareLinkPolicy({ shareLinks: { enabled: false } }).allowed()).toBe(false)
  })

  it('asks again every time, so a setting that changes takes effect at once', () => {
    let enabled = true
    const policy = createShareLinkPolicy({
      shareLinks: {
        get enabled(): boolean {
          return enabled
        },
      },
    })
    expect(policy.allowed()).toBe(true)
    enabled = false
    expect(policy.allowed()).toBe(false)
  })
})
