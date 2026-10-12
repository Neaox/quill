import { describe, expect, it } from 'vitest'

import { fenceTitle, tabLabel, withTabLabel, hasTabAttribute } from './fence-meta.ts'

describe('fence meta', () => {
  it('reads a tab label in either syntax', () => {
    expect(tabLabel('[TypeScript]')).toBe('TypeScript')
    expect(tabLabel('{1,3} [config.ts]')).toBe('config.ts')
    expect(tabLabel('tab="Python"')).toBe('Python')
    expect(tabLabel('title="a.py" tab=\'Python 3\'')).toBe('Python 3')
    expect(tabLabel('[  ]')).toBeUndefined()
    expect(tabLabel('title="a.ts"')).toBeUndefined()
    expect(tabLabel(null)).toBeUndefined()
    expect(tabLabel(undefined)).toBeUndefined()
  })

  it('reads a title, and nothing that merely contains the word', () => {
    expect(fenceTitle('title="src/app.ts"')).toBe('src/app.ts')
    expect(fenceTitle("[TS] title='app.ts'")).toBe('app.ts')
    expect(fenceTitle('subtitle="no"')).toBeUndefined()
    expect(fenceTitle('title=""')).toBeUndefined()
    expect(fenceTitle(null)).toBeUndefined()
  })

  it('knows a Fumadocs tab by its attribute', () => {
    expect(hasTabAttribute('tab="npm"')).toBe(true)
    expect(hasTabAttribute('[npm]')).toBe(false)
    expect(hasTabAttribute(null)).toBe(false)
  })

  it('renames a tab where it was named, in the syntax it was named in', () => {
    expect(withTabLabel('[TS] {1}', 'TypeScript', 'bracket')).toBe('[TypeScript] {1}')
    expect(withTabLabel('tab="TS" title="a.ts"', 'TypeScript', 'bracket')).toBe(
      'tab="TypeScript" title="a.ts"',
    )
    expect(withTabLabel(null, 'Python', 'bracket')).toBe('[Python]')
    expect(withTabLabel('{1}', 'Python', 'attribute')).toBe('{1} tab="Python"')
  })

  it('writes a label that cannot break out of its syntax, and removes an empty one', () => {
    expect(withTabLabel('[a]', 'x]y"z\n', 'bracket')).toBe('[xyz]')
    expect(withTabLabel('tab="a"', 'say "hi"', 'attribute')).toBe('tab="say hi"')
    expect(withTabLabel('[a] {1}', '  ', 'bracket')).toBe('{1}')
    expect(withTabLabel('[a]', '', 'bracket')).toBeNull()
  })
})

describe('fence meta edge cases', () => {
  it('removes an attribute label, leaves a meta with no label alone, and adds one to nothing', () => {
    expect(withTabLabel('tab="a" {1}', '', 'attribute')).toBe('{1}')
    expect(withTabLabel('{1}', '', 'bracket')).toBe('{1}')
    expect(withTabLabel(null, 'X', 'attribute')).toBe('tab="X"')
  })
})

describe('a new bracket label', () => {
  it('leads the meta it joins', () => {
    expect(withTabLabel('{1}', 'X', 'bracket')).toBe('[X] {1}')
  })
})
