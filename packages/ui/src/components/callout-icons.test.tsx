import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CALLOUT_ICONS, CALLOUT_ICON_SHAPES } from './callout-icons.tsx'
import type { CalloutKind } from './callout-icons.tsx'

const proseCss = readFileSync(
  fileURLToPath(import.meta.resolve('@quill/design-css/prose.css')),
  'utf8',
)

const KINDS = [
  'note',
  'info',
  'tip',
  'important',
  'warning',
  'caution',
] as const satisfies readonly CalloutKind[]

/** The rule that sets a kind's mask: the base `.callout` for a note, `.callout-<kind>` otherwise. */
function maskSvg(kind: CalloutKind): Document {
  const selector = kind === 'note' ? '.prose .callout {' : `.prose .callout-${kind} {`
  const start = proseCss.indexOf(selector)
  const rule = proseCss.slice(start, proseCss.indexOf('}', start))
  const uri = /--callout-icon:\s*url\("data:image\/svg\+xml,([^"]+)"\)/.exec(rule)?.[1]
  if (start < 0 || uri === undefined) throw new Error(`prose.css has no mask for ${kind}`)
  return new DOMParser().parseFromString(decodeURIComponent(uri), 'image/svg+xml')
}

/** Each drawn element as its tag and geometry, so two SVGs compare by what they draw. */
function drawing(root: ParentNode): string[] {
  return [...root.querySelectorAll('path, circle')].map((element) =>
    [
      element.tagName.toLowerCase(),
      ...['d', 'cx', 'cy', 'r'].map((name) => element.getAttribute(name) ?? ''),
    ].join(' '),
  )
}

describe('callout icons', () => {
  it('covers the six callout kinds', () => {
    expect(Object.keys(CALLOUT_ICONS)).toEqual(KINDS)
    expect(Object.keys(CALLOUT_ICON_SHAPES)).toEqual(KINDS)
  })

  it.each(KINDS)('draws %s exactly as the reader’s CSS mask does', (kind) => {
    const css = maskSvg(kind)
    const Icon = CALLOUT_ICONS[kind]
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    const cssSvg = css.documentElement

    expect(drawing(container)).toEqual(drawing(css))
    expect(svg?.getAttribute('viewBox')).toBe(cssSvg.getAttribute('viewBox'))
    expect(svg?.getAttribute('stroke-width')).toBe(cssSvg.getAttribute('stroke-width'))
    expect(svg?.getAttribute('stroke-linecap')).toBe(cssSvg.getAttribute('stroke-linecap'))
    expect(svg?.getAttribute('stroke-linejoin')).toBe(cssSvg.getAttribute('stroke-linejoin'))
  })

  it.each(KINDS)('%s is decorative and out of the tab order', (kind) => {
    const Icon = CALLOUT_ICONS[kind]
    const { container } = render(<Icon className="text-accent" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveClass('text-accent')
  })

  it('gives every kind its own mark', () => {
    const marks = new Set(KINDS.map((kind) => drawing(maskSvg(kind)).join('|')))
    expect(marks.size).toBe(KINDS.length)
  })
})
