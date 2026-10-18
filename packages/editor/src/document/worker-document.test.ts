import { characterEntities } from 'character-entities'
import { describe, expect, it } from 'vitest'

import { standInForDocument } from './worker-document.ts'

/**
 * micromark's browser build decodes `&copy;` by setting an element's
 * `innerHTML` (`decode-named-character-reference`); the parse worker has no
 * document, so it is given an element that answers from the entity table, as
 * the page's own would.
 */

interface Scope {
  document?: { createElement(tag: string): { innerHTML: string; textContent: string } }
}

/** What the browser build of `decode-named-character-reference` does with the element. */
function decode(scope: Scope, name: string): string | false {
  const element = scope.document?.createElement('i')
  if (element === undefined) throw new Error('No document.')
  const reference = `&${name};`
  element.innerHTML = reference
  const character = element.textContent
  if (character.endsWith(';') && name !== 'semi') return false
  return character === reference ? false : character
}

describe('the stand-in document of the parse worker', () => {
  it('decodes a named reference from the table, as the page would', () => {
    const scope: Scope = {}
    standInForDocument(scope, characterEntities)
    expect(decode(scope, 'copy')).toBe('©')
    expect(decode(scope, 'nbsp')).toBe(' ')
    expect(decode(scope, 'semi')).toBe(';')
    expect(decode(scope, 'notareference')).toBe(false)
    // A name the table inherits rather than holds is no reference either.
    expect(decode(scope, 'constructor')).toBe(false)
    expect(scope.document?.createElement('i').innerHTML).toBe('')
  })

  it('is taken away again once the pipeline has what it needs', () => {
    const scope: Scope = {}
    const remove = standInForDocument(scope, characterEntities)
    remove()
    expect('document' in scope).toBe(false)
  })

  it('leaves a real document alone', () => {
    const scope = { document: 'real' }
    standInForDocument(scope, characterEntities)()
    expect(scope.document).toBe('real')
  })
})
