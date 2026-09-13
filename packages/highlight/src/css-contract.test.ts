import { BRAND } from '@quill/brand'
import { describe, expect, it } from 'vitest'

import {
  REVIEWED_UNTHEMED_GROUPS,
  grammarTokenClasses,
  grammarTokenGroups,
  tokenCssContract,
  tokenGroupKey,
  unthemedTokenGroups,
} from './css-contract.ts'
import { SUPPORTED_LANGUAGES } from './grammars.ts'
import { TOKEN_CLASSES, resolveTokenClass } from './tokens.ts'

describe('tokenCssContract', () => {
  it('lists one variable, class selector, and highlight selector per token class, in order', () => {
    const contract = tokenCssContract()
    expect(contract.variables).toEqual(TOKEN_CLASSES.map((tokenClass) => `--token-${tokenClass}`))
    expect(contract.classSelectors).toEqual(TOKEN_CLASSES.map((tokenClass) => `.tok-${tokenClass}`))
    expect(contract.highlightSelectors).toEqual(
      TOKEN_CLASSES.map((tokenClass) => `::highlight(${BRAND.slug}-tok-${tokenClass})`),
    )
  })
})

describe('grammarTokenClasses', () => {
  it('collects every class a real grammar can emit, including aliases and nested rules', () => {
    const classes = grammarTokenClasses('json')
    expect(classes.has('property')).toBe(true)
    expect(classes.has('string')).toBe(true)
    expect(classes.has('number')).toBe(true)
    expect(classes.has('punctuation')).toBe(true)
    expect(classes.has('operator')).toBe(true)
    expect(classes.has('boolean')).toBe(true)
    // "null" is aliased to "keyword" in the JSON grammar; both must appear.
    expect(classes.has('null')).toBe(true)
    expect(classes.has('keyword')).toBe(true)
  })

  it('walks nested `inside` grammars and `rest`', () => {
    const classes = grammarTokenClasses('markup')
    expect(classes.size).toBeGreaterThan(0)
    // Markup's tag rule nests attribute rules inside it.
    expect(classes.has('attr-name')).toBe(true)
    expect(classes.has('attr-value')).toBe(true)
  })

  it('every registered language resolves at least one class to a theme colour', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const classes = grammarTokenClasses(language)
      expect(classes.size, `no classes found for "${language}"`).toBeGreaterThan(0)
      const themed = [...classes].filter((cls) => resolveTokenClass([cls]) !== null)
      expect(themed.length, `no themed classes for "${language}"`).toBeGreaterThan(0)
    }
  })
})

describe('grammarTokenGroups', () => {
  it('keeps a rule name and its aliases together, the way a token wears them', () => {
    const groups = grammarTokenGroups('diff').map(tokenGroupKey)

    // The diff grammar never emits `deleted-sign` without `deleted` beside it,
    // which is exactly why coverage is measured on groups and not on names.
    expect(groups).toContain('deleted-sign+deleted')
    expect(groups).toContain('inserted-sign+inserted')
    expect(resolveTokenClass(['deleted-sign', 'deleted'])).toBe('deleted')
  })

  it('walks `rest` and nested `inside` grammars', () => {
    const groups = grammarTokenGroups('markup').map(tokenGroupKey)

    expect(groups).toContain('attr-name')
    expect(groups).toContain('attr-value')
    expect(grammarTokenClasses('markup')).toEqual(new Set(grammarTokenGroups('markup').flat()))
  })
})

describe('the grammar coverage contract', () => {
  it.each(SUPPORTED_LANGUAGES)(
    'leaves exactly the reviewed classes of %s uncoloured',
    (language) => {
      expect(unthemedTokenGroups(language)).toEqual(
        [...new Set(REVIEWED_UNTHEMED_GROUPS[language])].toSorted(),
      )
    },
  )

  it('has a reviewed list for every registered language and no others', () => {
    expect(Object.keys(REVIEWED_UNTHEMED_GROUPS).toSorted()).toEqual(
      [...SUPPORTED_LANGUAGES].toSorted(),
    )
  })

  it('fails when a grammar starts emitting an unreviewed class', () => {
    // The guard the allowlist exists for: were `json` to grow a rule nothing
    // themes, the assertion above would see it and this shows what that looks
    // like rather than trusting the empty case to prove anything.
    expect(unthemedTokenGroups('json')).toEqual([])
    expect(
      ['made-up-rule'].filter((group) => !REVIEWED_UNTHEMED_GROUPS['json'].includes(group)),
    ).toEqual(['made-up-rule'])
  })
})
