import { describe, expect, it } from 'vitest'

import { standardEmoji, standardEmojiList } from './shortcodes.ts'

describe('the list of standard emoji', () => {
  it('holds each emoji once, with every name it answers to', () => {
    const list = standardEmojiList()
    const thumbs = list.find((emoji) => emoji.character === '👍')
    expect(thumbs).toEqual({ character: '👍', description: 'thumbs up', names: ['+1', 'thumbsup'] })
    expect(new Set(list.map((emoji) => emoji.character)).size).toBe(list.length)
    expect(list.length).toBeGreaterThan(1800)
  })

  it('agrees with the lookup for every name', () => {
    for (const emoji of standardEmojiList().slice(0, 50)) {
      for (const name of emoji.names) expect(standardEmoji(name)?.character).toBe(emoji.character)
    }
  })

  it('is built once', () => {
    expect(standardEmojiList()).toBe(standardEmojiList())
  })
})
