import { describe, expect, it } from 'vitest'

import { cx, tv } from './class-names.ts'

describe('cx', () => {
  it('joins class names with a single space', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('drops undefined, null, false, and empty strings', () => {
    expect(cx('a', undefined, null, false, '', 'b')).toBe('a b')
  })

  it('returns an empty string when nothing is passed', () => {
    expect(cx()).toBe('')
  })

  it('lets the last of two conflicting utilities win', () => {
    expect(cx('p-4', 'p-0')).toBe('p-0')
    expect(cx('bg-surface', 'bg-surface-raised')).toBe('bg-surface-raised')
  })

  it('keeps utilities that only look alike', () => {
    expect(cx('text-2xs', 'text-muted')).toBe('text-2xs text-muted')
    expect(cx('font-mono', 'font-medium')).toBe('font-mono font-medium')
  })

  it.each([
    ['text-reading', 'text-sm'],
    ['font-reading', 'font-display'],
    ['tracking-caps', 'tracking-wide'],
    ['shadow-raised', 'shadow-dialog'],
    ['ease-standard', 'ease-exit'],
  ])('knows %s and %s are the same design-system utility', (first, second) => {
    expect(cx(first, second)).toBe(second)
  })
})

describe('tv', () => {
  const badge = tv({
    base: 'inline-flex text-2xs',
    variants: { tone: { neutral: 'text-muted', accent: 'text-accent' } },
    defaultVariants: { tone: 'neutral' },
  })

  it('carries the design system merge configuration', () => {
    expect(badge({ tone: 'accent', class: 'text-reading' })).toBe(
      'inline-flex text-accent text-reading',
    )
  })

  it('applies the default variant', () => {
    expect(badge()).toBe('inline-flex text-2xs text-muted')
  })
})
