import { describe, expect, it } from 'vitest'

import { textLinkClassName } from './text-link.tsx'

describe('textLinkClassName', () => {
  it('takes the surrounding text size by default, so a link in prose matches its sentence', () => {
    const classes = textLinkClassName()

    expect(classes).toContain('text-accent')
    expect(classes).toContain('underline')
    expect(classes).not.toContain('text-xs')
    expect(classes).not.toContain('text-sm')
  })

  it('offers the two smaller sizes the product actually uses', () => {
    expect(textLinkClassName({ size: 'xs' })).toContain('text-xs')
    expect(textLinkClassName({ size: 'sm' })).toContain('text-sm')
  })

  it('merges a caller class rather than concatenating a conflicting one', () => {
    expect(textLinkClassName({ size: 'xs', className: 'text-sm' })).toContain('text-sm')
    expect(textLinkClassName({ size: 'xs', className: 'text-sm' })).not.toContain('text-xs')
  })
})
