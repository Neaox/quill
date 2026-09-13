import { describe, expect, it } from 'vitest'

import { NO_NEWLINE, unifiedDiff } from './unified-diff.ts'

const PATH = 'handbook/onboarding.md'

describe('unifiedDiff', () => {
  it('returns nothing for identical text', () => {
    expect(unifiedDiff(PATH, 'same\n', 'same\n')).toEqual({ text: '', added: 0, removed: 0 })
  })

  it('returns nothing when neither side has a trailing newline', () => {
    expect(unifiedDiff(PATH, 'same', 'same').text).toBe('')
  })

  it('writes a header naming the document on both sides', () => {
    const diff = unifiedDiff(PATH, 'one\n', 'two\n')
    expect(diff.text.startsWith(`--- a/${PATH}\n+++ b/${PATH}\n`)).toBe(true)
  })

  it('counts added and removed lines', () => {
    const diff = unifiedDiff(PATH, 'one\ntwo\n', 'one\ntwo\nthree\nfour\n')
    expect(diff).toMatchObject({ added: 2, removed: 0 })
  })

  it('renders a replacement as a removal then an addition', () => {
    const diff = unifiedDiff(PATH, 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
    expect(diff.text).toBe(
      [
        `--- a/${PATH}`,
        `+++ b/${PATH}`,
        '@@ -1,3 +1,3 @@',
        ' one',
        '-two',
        '+TWO',
        ' three',
        '',
      ].join('\n'),
    )
  })

  it('writes an empty range as zero when a document is created', () => {
    const diff = unifiedDiff(PATH, '', 'one\n')
    expect(diff.text).toContain('@@ -0,0 +1,1 @@')
    expect(diff).toMatchObject({ added: 1, removed: 0 })
  })

  it('writes an empty range as zero when a document is emptied', () => {
    expect(unifiedDiff(PATH, 'one\n', '').text).toContain('@@ -1,1 +0,0 @@')
  })

  it('keeps changes closer than two context widths in one hunk', () => {
    const before = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 0', 'first').replace('line 5', 'sixth')
    expect(countHunks(unifiedDiff(PATH, before, after).text)).toBe(1)
  })

  it('splits distant changes into separate hunks', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 0', 'first').replace('line 30', 'thirty-first')
    expect(countHunks(unifiedDiff(PATH, before, after).text)).toBe(2)
  })

  it('shows a lost trailing newline the way git does', () => {
    expect(unifiedDiff(PATH, 'same\n', 'same').text).toBe(
      [`--- a/${PATH}`, `+++ b/${PATH}`, '@@ -1,1 +1,1 @@', '-same', '+same', NO_NEWLINE, ''].join(
        '\n',
      ),
    )
  })

  it('shows a gained trailing newline the way git does', () => {
    expect(unifiedDiff(PATH, 'same', 'same\n').text).toBe(
      [`--- a/${PATH}`, `+++ b/${PATH}`, '@@ -1,1 +1,1 @@', '-same', NO_NEWLINE, '+same', ''].join(
        '\n',
      ),
    )
  })

  it('marks an unterminated line that is only context', () => {
    const diff = unifiedDiff(PATH, 'one\ntwo', 'one\ntwo\nthree\n')
    expect(diff.text).toContain(` two\n${NO_NEWLINE}\n+three\n`)
  })

  it('marks an unterminated line that was removed', () => {
    expect(unifiedDiff(PATH, 'one\ntwo', 'one\n').text).toContain(`-two\n${NO_NEWLINE}\n`)
  })

  it('does not mark a side whose last line it never reaches', () => {
    const before = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n')
    expect(unifiedDiff(PATH, before, before.replace('line 0', 'first')).text).not.toContain(
      NO_NEWLINE,
    )
  })

  it('takes the context width from the caller', () => {
    const before = Array.from({ length: 9 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 4', 'middle')
    expect(unifiedDiff(PATH, before, after, 1).text).toContain('@@ -4,3 +4,3 @@')
  })
})

function countHunks(text: string): number {
  return text.split('\n').filter((line) => line.startsWith('@@')).length
}
