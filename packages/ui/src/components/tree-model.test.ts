import { afterEach, describe, expect, it, vi } from 'vitest'

import { readChoices, writeChoices } from './tree-model.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('the branches opened or closed by hand', () => {
  it('round-trips through the session, under its key', () => {
    writeChoices('ws-1', new Map([['architecture', true]]))

    expect([...readChoices('ws-1')]).toEqual([['architecture', true]])
    expect(readChoices('ws-2').size).toBe(0)
  })

  it('keeps only well-formed choices from what is stored', () => {
    sessionStorage.setItem(
      'document-tree:ws-1',
      JSON.stringify([['architecture', true], ['runbooks'], [3, false], 'loose']),
    )

    expect([...readChoices('ws-1')]).toEqual([['architecture', true]])
  })

  it('starts afresh from something stored that is not a list of choices', () => {
    sessionStorage.setItem('document-tree:ws-1', JSON.stringify({ architecture: true }))

    expect(readChoices('ws-1').size).toBe(0)
  })

  it('starts afresh from something stored that is not JSON at all', () => {
    sessionStorage.setItem('document-tree:ws-1', '{not json')

    expect(readChoices('ws-1').size).toBe(0)
  })

  it('draws the same without storage, when a browser has none or refuses it', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })

    expect(() => {
      writeChoices('ws-1', new Map([['architecture', true]]))
    }).not.toThrow()
    expect(readChoices('ws-1').size).toBe(0)

    vi.stubGlobal('sessionStorage', undefined)
    expect(readChoices('ws-1').size).toBe(0)
  })
})
