// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ResolvedPublicMenu } from '@quill/application'

import { parseHtml, type TestDocument } from '../../test-support/dom.ts'
import { externalLinkRel, renderHeaderMenu, type PageAudience } from './header-menu.ts'

/**
 * The header menu: standalone links and dropdowns, written so that every part
 * of it works with no script — a dropdown is a `details` — and so that what a
 * screen reader hears is the structure, not the styling.
 */

const MENU: ResolvedPublicMenu = [
  {
    kind: 'link',
    link: { label: 'Guides', href: '/s/acme-docs', external: false, referrer: 'hidden' },
  },
  {
    kind: 'group',
    label: 'Products',
    links: [
      { label: 'Sync', href: '/s/acme-docs/guides/sync', external: false, referrer: 'hidden' },
      { label: 'API', href: '/s/acme-api', external: false, referrer: 'hidden' },
    ],
  },
  {
    kind: 'link',
    link: {
      label: 'Status',
      href: 'https://status.example.com',
      external: true,
      referrer: 'hidden',
    },
  },
]

function render(
  menu = MENU,
  currentHref: string | null = null,
  audience: PageAudience = 'public',
): TestDocument {
  return parseHtml(renderHeaderMenu({ menu, currentHref, audience }).value)
}

describe('renderHeaderMenu', () => {
  it('renders nothing for an empty menu', () => {
    expect(renderHeaderMenu({ menu: [], currentHref: null, audience: 'public' }).value).toBe('')
  })

  it('is a labelled navigation landmark of links, in the configured order', () => {
    const bar = render().querySelector('nav.site-bar')
    expect(bar?.getAttribute('aria-label')).toBe('Site')
    const top = [...(bar?.querySelectorAll(':scope > ul > li') ?? [])].map((item) =>
      item
        .querySelector(':scope > a, :scope > details > summary')
        ?.textContent?.replace('(external)', '')
        .trim(),
    )
    expect(top).toEqual(['Guides', 'Products', 'Status'])
  })

  it('makes a dropdown a details element, so it opens with no script and from the keyboard', () => {
    const dropdown = render().querySelector('nav.site-bar details.site-dropdown')
    expect(dropdown).not.toBeNull()
    expect(dropdown?.hasAttribute('open')).toBe(false)
    const summary = dropdown?.querySelector(':scope > summary')
    expect(summary?.textContent?.trim()).toBe('Products')
    // The disclosure's contents are a plain list of links: navigation, not an
    // ARIA menu, which would promise arrow-key behaviour a list of links lacks.
    expect(dropdown?.querySelector('[role="menu"], [role="menuitem"]')).toBeNull()
    expect(
      [...(dropdown?.querySelectorAll('.site-dropdown-panel a') ?? [])].map((link) => [
        link.textContent?.trim(),
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Sync', '/s/acme-docs/guides/sync'],
      ['API', '/s/acme-api'],
    ])
  })

  it('marks an external link with noopener and says so beyond an icon', () => {
    const status = render().querySelector('nav.site-bar a[href="https://status.example.com"]')
    expect(status?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(status?.querySelector('.visually-hidden')?.textContent).toMatch(/external/u)
    expect(render().querySelector('nav.site-bar a[href="/s/acme-docs"]')?.hasAttribute('rel')).toBe(
      false,
    )
  })

  it('marks the page being read, and the dropdown it is in, by more than colour', () => {
    const document = render(MENU, '/s/acme-docs/guides/sync')
    const sync = document.querySelector('nav.site-bar a[href="/s/acme-docs/guides/sync"]')
    expect(sync?.getAttribute('aria-current')).toBe('page')
    expect(
      document.querySelector('nav.site-bar .site-dropdown')?.getAttribute('data-current'),
    ).toBe('true')
    expect(
      render().querySelector('nav.site-bar .site-dropdown')?.getAttribute('data-current'),
    ).toBe('false')
    // The site a page belongs to is current too, as the section of it.
    expect(
      document.querySelector('nav.site-bar a[href="/s/acme-docs"]')?.getAttribute('aria-current'),
    ).toBe('true')
    expect(
      document.querySelector('nav.site-bar a[href="/s/acme-api"]')?.hasAttribute('aria-current'),
    ).toBe(false)
  })

  it('folds into one disclosure for a narrow screen, with every link and each dropdown as a labelled group', () => {
    const compact = render().querySelector('details.site-compact')
    expect(compact?.querySelector(':scope > summary')?.textContent).toMatch(/Menu/u)
    const nav = compact?.querySelector('nav')
    expect(nav?.getAttribute('aria-label')).toBe('Site')
    expect(
      [...(nav?.querySelectorAll('a') ?? [])].map((link) =>
        link.textContent?.replace('(external)', '').trim(),
      ),
    ).toEqual(['Guides', 'Sync', 'API', 'Status'])
    const group = nav?.querySelector('[role="group"]')
    const labelledBy = group?.getAttribute('aria-labelledby') ?? ''
    expect(nav?.querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe('Products')
  })

  it('escapes every label and address, which an administrator typed', () => {
    const markup = renderHeaderMenu({
      audience: 'public',
      menu: [
        {
          kind: 'link',
          link: {
            label: '<img src=x onerror=alert(1)>',
            href: '/a"b',
            external: false,
            referrer: 'hidden',
          },
        },
        {
          kind: 'group',
          label: '<script>alert(1)</script>',
          links: [{ label: 'x', href: '/x', external: false, referrer: 'hidden' }],
        },
      ],
      currentHref: null,
    }).value
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('href="/a&quot;b"')
  })

  it('gives each dropdown its own ids, so two with the same label do not collide', () => {
    const document = render([
      {
        kind: 'group',
        label: 'More',
        links: [{ label: 'a', href: '/a', external: false, referrer: 'hidden' }],
      },
      {
        kind: 'group',
        label: 'More',
        links: [{ label: 'b', href: '/b', external: false, referrer: 'hidden' }],
      },
    ])
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never carries a referrerpolicy or a target, so nothing widens the page’s Referrer-Policy', () => {
    const document = render(
      [
        {
          kind: 'link',
          link: {
            label: 'Partner',
            href: 'https://partner.test',
            external: true,
            referrer: 'sent',
          },
        },
        ...MENU,
      ],
      '/s/acme-docs',
    )
    const links = [...document.querySelectorAll('a')]
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.hasAttribute('referrerpolicy')).toBe(false)
      expect(link.hasAttribute('target')).toBe(false)
    }
  })

  it('lets a public page send its origin to a link an administrator allowed, and never a private one', () => {
    const partner: ResolvedPublicMenu = [
      {
        kind: 'link',
        link: { label: 'Partner', href: 'https://partner.test', external: true, referrer: 'sent' },
      },
    ]
    const relIn = (audience: PageAudience) =>
      [...render(partner, null, audience).querySelectorAll('a[href="https://partner.test"]')].map(
        (link) => link.getAttribute('rel'),
      )
    // Twice each: the bar and the narrow-screen menu.
    expect(relIn('public')).toEqual(['noopener', 'noopener'])
    expect(relIn('private')).toEqual(['noopener noreferrer', 'noopener noreferrer'])
  })
})

describe('externalLinkRel', () => {
  it.each([
    ['hidden', 'public', 'noopener noreferrer'],
    ['sent', 'public', 'noopener'],
    ['hidden', 'private', 'noopener noreferrer'],
    ['sent', 'private', 'noopener noreferrer'],
  ] as const)('a link whose referrer is %s, on a %s page, is %s', (referrer, audience, rel) => {
    expect(externalLinkRel(referrer, audience)).toBe(rel)
  })

  it('always says noopener', () => {
    for (const referrer of ['hidden', 'sent'] as const) {
      for (const audience of ['public', 'private'] as const) {
        expect(externalLinkRel(referrer, audience).split(' ')).toContain('noopener')
      }
    }
  })
})
