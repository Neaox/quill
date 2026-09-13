import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PlainLink, linkHref } from './link.tsx'

describe('linkHref', () => {
  it('returns a pattern with no parameters unchanged', () => {
    expect(linkHref({ to: '/w/engineering' })).toBe('/w/engineering')
  })

  it('substitutes every `$name` placeholder from `params`', () => {
    expect(
      linkHref({
        to: '/w/$workspaceSlug/d/$documentId',
        params: { workspaceSlug: 'engineering', documentId: 'failover-k7m3q9v2xd' },
      }),
    ).toBe('/w/engineering/d/failover-k7m3q9v2xd')
  })

  it('encodes a parameter, so a slug can never escape its segment', () => {
    expect(linkHref({ to: '/w/$workspaceSlug', params: { workspaceSlug: 'a/b c' } })).toBe(
      '/w/a%2Fb%20c',
    )
  })

  it('leaves a placeholder the caller gave no value for alone rather than emitting `undefined`', () => {
    expect(linkHref({ to: '/w/$workspaceSlug' })).toBe('/w/$workspaceSlug')
  })

  it('serialises search values into a query string', () => {
    expect(linkHref({ to: '/d/$id', params: { id: 'x' }, search: { rev: 'abc', step: 3 } })).toBe(
      '/d/x?rev=abc&step=3',
    )
  })

  it('emits no `?` for an empty search object', () => {
    expect(linkHref({ to: '/home', search: {} })).toBe('/home')
  })

  it('leaves out a search key the route declares and this link does not use', () => {
    expect(linkHref({ to: '/home', search: { rev: undefined, from: 'a' } })).toBe('/home?from=a')
  })

  it('appends a hash, and omits an empty one', () => {
    expect(linkHref({ to: '/home', hash: 'section-2' })).toBe('/home#section-2')
    expect(linkHref({ to: '/home', hash: '' })).toBe('/home')
  })
})

describe('PlainLink', () => {
  it('renders an anchor at the resolved address, keeping the props it was handed', () => {
    render(
      <PlainLink
        to="/w/$workspaceSlug"
        params={{ workspaceSlug: 'engineering' }}
        search={{ rev: 'v12' }}
        className="link"
        aria-current="page"
        title="Engineering"
      >
        Engineering
      </PlainLink>,
    )

    const link = screen.getByRole('link', { name: 'Engineering' })
    expect(link).toHaveAttribute('href', '/w/engineering?rev=v12')
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('title', 'Engineering')
    expect(link).toHaveClass('link')
  })
})
