import { tags } from '@lezer/highlight'
import { TOKEN_CLASSES } from '@quill/highlight'
import { describe, expect, it } from 'vitest'

import {
  TAG_TOKEN_CLASSES,
  UNMAPPED_TOKEN_CLASSES,
  tokenHighlightStyle,
  tokenHighlighting,
  tokenVariable,
} from './highlight-style.ts'

describe('the editor syntax colours', () => {
  it('reads a colour from the token variable of the reading surface', () => {
    expect(tokenVariable('string')).toBe('var(--token-string)')
  })

  it('maps every tag onto a class the highlight package owns', () => {
    for (const [, tokenClass] of TAG_TOKEN_CLASSES) {
      expect(TOKEN_CLASSES).toContain(tokenClass)
    }
  })

  it('gives every themed class a tag, or says in one place why it has none', () => {
    const mapped = new Set(TAG_TOKEN_CLASSES.map(([, tokenClass]) => tokenClass))
    const unmapped = TOKEN_CLASSES.filter((tokenClass) => !mapped.has(tokenClass))
    expect(unmapped).toEqual(UNMAPPED_TOKEN_CLASSES)
  })

  it('reviews nothing it also maps, so the allowlist stays an allowlist', () => {
    const mapped = new Set(TAG_TOKEN_CLASSES.map(([, tokenClass]) => tokenClass))
    for (const tokenClass of UNMAPPED_TOKEN_CLASSES) expect(mapped.has(tokenClass)).toBe(false)
  })

  it('claims each token class at most once, so a tag has one colour', () => {
    const claimed = TAG_TOKEN_CLASSES.map(([, tokenClass]) => tokenClass)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('gives the tags a writer meets most often a style', () => {
    for (const tag of [tags.keyword, tags.string, tags.comment, tags.number]) {
      expect(tokenHighlightStyle.style([tag])).not.toBeNull()
    }
  })

  it('paints colour and nothing else, because the reading surface cannot paint more', () => {
    const rules = tokenHighlightStyle.module?.getRules() ?? ''
    expect(rules).toContain('var(--token-')
    expect(rules).not.toContain('font-style')
    expect(rules).not.toContain('font-weight')
  })

  it('is an extension a CodeMirror editor can be built with', () => {
    expect(tokenHighlighting).toBeDefined()
  })
})
