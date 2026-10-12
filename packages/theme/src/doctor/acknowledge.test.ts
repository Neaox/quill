import { describe, expect, it } from 'vitest'
import { grid } from '../builtin/grid.ts'
import { instrument } from '../builtin/instrument.ts'
import { validateThemeDocument } from '../schema/validate.ts'
import { acknowledgeRule, withdrawAcknowledgement } from './acknowledge.ts'
import { runThemeDoctor } from './run.ts'

describe('acknowledging a warning', () => {
  it('records the rule in the theme document, once', () => {
    const accepted = acknowledgeRule(grid, 'chroma/area-budget')
    expect(accepted.acknowledged).toEqual(['chroma/area-budget'])
    expect(acknowledgeRule(accepted, 'chroma/area-budget')).toBe(accepted)
    expect(validateThemeDocument(accepted).valid).toBe(true)
  })

  it('withdraws it, and leaves no empty list behind', () => {
    const accepted = acknowledgeRule(acknowledgeRule(grid, 'a/b'), 'chroma/area-budget')
    expect(withdrawAcknowledgement(accepted, 'a/b').acknowledged).toEqual(['chroma/area-budget'])
    const none = withdrawAcknowledgement(
      withdrawAcknowledgement(accepted, 'a/b'),
      'chroma/area-budget',
    )
    expect(none).not.toHaveProperty('acknowledged')
    expect(withdrawAcknowledgement(grid, 'a/b')).toEqual(grid)
  })

  it('is a list of distinct rule ids, which the schema checks', () => {
    expect(validateThemeDocument({ ...instrument, acknowledged: ['Not a rule'] }).valid).toBe(false)
    expect(
      validateThemeDocument({
        ...instrument,
        acknowledged: ['chroma/area-budget', 'chroma/area-budget'],
      }).valid,
    ).toBe(false)
  })

  it('marks a warning the tenant accepted, and nothing that does not warn', () => {
    const accepted = acknowledgeRule(
      acknowledgeRule(grid, 'chroma/area-budget'),
      'legibility/text-contrast',
    )
    const results = runThemeDoctor(accepted).results
    const budget = results.find((result) => result.id === 'chroma/area-budget')
    const contrast = results.find((result) => result.id === 'legibility/text-contrast')

    expect(budget).toMatchObject({ status: 'warn', acknowledged: true })
    expect(contrast).toMatchObject({ status: 'pass', acknowledged: false })
    expect(runThemeDoctor(grid).results.every((result) => !result.acknowledged)).toBe(true)
  })
})
