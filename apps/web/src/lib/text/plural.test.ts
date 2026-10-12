import { describe, expect, it } from 'vitest'

import { counted } from './plural.ts'

describe('counted', () => {
  it('uses the singular for one and the plural for everything else, zero included', () => {
    const block = { one: 'block', other: 'blocks' }

    expect([0, 1, 2, 11].map((count) => counted(count, block))).toEqual([
      '0 blocks',
      '1 block',
      '2 blocks',
      '11 blocks',
    ])
  })

  it('follows the language it is asked for, which is where forms other than two come from', () => {
    const forms = { one: 'книга', few: 'книги', many: 'книг', other: 'книги' }

    expect([1, 2, 5, 21].map((count) => counted(count, forms, 'ru'))).toEqual([
      '1 книга',
      '2 книги',
      '5 книг',
      '21 книга',
    ])
  })

  it('groups the digits as the language does', () => {
    expect(counted(1234, { one: 'word', other: 'words' })).toBe('1,234 words')
  })
})
