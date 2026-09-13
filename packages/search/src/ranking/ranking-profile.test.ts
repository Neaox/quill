import { describe, expect, it } from 'vitest'

import { DEFAULT_RANKING_PROFILE, recencyMultiplier } from './ranking-profile.ts'

describe('DEFAULT_RANKING_PROFILE', () => {
  it('pins the default field weights: title over headings over body', () => {
    expect(DEFAULT_RANKING_PROFILE.fieldWeights).toEqual({ title: 10, headings: 5, body: 1 })
  })

  it('pins the default recency boost', () => {
    expect(DEFAULT_RANKING_PROFILE.recencyBoost).toEqual({ halfLifeDays: 90, maxBoost: 0.2 })
  })

  it('pins the default exact-phrase boost', () => {
    expect(DEFAULT_RANKING_PROFILE.exactPhraseBoost).toBe(2)
  })

  it('pins the default workspace affinity', () => {
    expect(DEFAULT_RANKING_PROFILE.workspaceAffinity).toEqual({
      currentWorkspaceBoost: 2,
      groupOthersByWorkspace: true,
    })
  })
})

describe('recencyMultiplier', () => {
  it('gives a freshly updated document the full boost', () => {
    expect(recencyMultiplier(DEFAULT_RANKING_PROFILE, 0)).toBeCloseTo(1.2)
  })

  it('halves the boost after one half-life', () => {
    expect(recencyMultiplier(DEFAULT_RANKING_PROFILE, 90)).toBeCloseTo(1.1)
  })

  it('decays toward no boost as the document ages further', () => {
    expect(recencyMultiplier(DEFAULT_RANKING_PROFILE, 900)).toBeCloseTo(1, 2)
  })

  it('treats a negative age the same as brand new, rather than boosting further', () => {
    expect(recencyMultiplier(DEFAULT_RANKING_PROFILE, -10)).toBeCloseTo(1.2)
  })
})
