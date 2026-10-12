import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  CALLOUT_TYPES,
  EMOJI_ASSET_URL,
  EMOJI_NAME,
  KNOWN_DIRECTIVES,
  LABEL_NAME,
} from '@quill/markdown'
import { emojiUrl } from '@quill/application'
import {
  BUILT_IN_DIRECTIVE_NAMES,
  DRAWING_CLASS_NAMES,
  EMOJI_NAME_PATTERN,
  LABEL_NAME_PATTERN,
} from '@quill/theme'

/**
 * ADR-037 puts a label's name in the theme and its rendering in the Markdown
 * package, and neither depends on the other. The server depends on both, so
 * it is where the two are held to one another: the theme refuses exactly the
 * names the renderer and the reading stylesheet already give a meaning to,
 * and both read a name in the same shape.
 */

const sorted = (names: Iterable<string>): readonly string[] => [...new Set(names)].toSorted()

/** Every class the reading stylesheet's drawing vocabulary styles. */
function drawingVocabulary(): readonly string[] {
  const css = readFileSync(
    fileURLToPath(import.meta.resolve('@quill/design-css/prose.css')),
    'utf8',
  )
  const selectors = css.match(/\.diagram\[data-diagram='svg'\][^{]*\{/gu) ?? []
  return sorted(
    selectors.flatMap((selector) =>
      Array.from(
        selector.replace(/^\.diagram\[data-diagram='svg'\]/u, '').matchAll(/\.([a-z][a-z-]*)/gu),
        (match) => match[1] ?? '',
      ),
    ),
  )
}

describe('the names a tenant label may not take', () => {
  it('are every directive name the renderer knows, the callout types among them', () => {
    expect(sorted(BUILT_IN_DIRECTIVE_NAMES)).toEqual(
      sorted([...KNOWN_DIRECTIVES.flatMap((definition) => definition.names), ...CALLOUT_TYPES]),
    )
  })

  it('are every class the drawing vocabulary styles', () => {
    expect(sorted(DRAWING_CLASS_NAMES)).toEqual(drawingVocabulary())
  })

  it('are read in one shape by the theme and the renderer', () => {
    expect(LABEL_NAME.source).toBe(LABEL_NAME_PATTERN)
  })
})

describe('a custom emoji’s name and address (ADR-038)', () => {
  it('are read in one shape by the settings and the renderer', () => {
    expect(EMOJI_NAME.source).toBe(EMOJI_NAME_PATTERN)
  })

  it('are served where the renderer’s sanitiser admits an emoji image', () => {
    for (const mediaType of ['image/png', 'image/webp', 'image/svg+xml'] as const) {
      const url = emojiUrl({
        name: 'booking_com',
        hash: 'f'.repeat(64),
        mediaType,
        width: 1,
        height: 1,
      })
      expect(EMOJI_ASSET_URL.test(url)).toBe(true)
    }
  })
})
