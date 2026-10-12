import { describe, expect, it } from 'vitest'

import {
  defaultOrganisationSettings,
  ORGANISATION_SETTINGS_VERSION,
  parseOrganisationSettings,
  validateOrganisationSettings,
} from './documents.ts'
import {
  MAX_PUBLIC_MENU_GROUP_LINKS,
  MAX_PUBLIC_MENU_ITEMS,
  menuTargetIds,
  PUBLIC_MENU_URL_PATTERN,
  publicMenuFromNavigation,
  type PublicMenu,
} from './public-menu.ts'

const DOCUMENT = '0192f0aa-0000-7000-8000-000000000001'
const COLLECTION = '0192f0aa-0000-7000-8000-000000000002'

const organisation = defaultOrganisationSettings()

const validWith = (publicMenu: unknown): boolean =>
  validateOrganisationSettings({ ...organisation, publicMenu }).valid

describe('the public menu (settings version 2)', () => {
  it('starts empty', () => {
    expect(organisation.version).toBe(ORGANISATION_SETTINGS_VERSION)
    expect(organisation.publicMenu).toEqual([])
  })

  it('holds standalone links to a document, a collection and an address, and dropdown groups', () => {
    const menu: PublicMenu = [
      { kind: 'document', id: DOCUMENT },
      { kind: 'collection', id: COLLECTION, label: 'Guides' },
      { kind: 'url', href: 'https://status.example.com', label: 'Status' },
      {
        kind: 'group',
        label: 'Products',
        items: [
          { kind: 'document', id: DOCUMENT, label: 'Sync' },
          { kind: 'url', href: '/s/handbook', label: 'Handbook' },
        ],
      },
    ]
    expect(validWith(menu)).toBe(true)
  })

  it('refuses a group inside a group: dropdowns are one level deep', () => {
    expect(
      validWith([
        {
          kind: 'group',
          label: 'Outer',
          items: [{ kind: 'group', label: 'Inner', items: [{ kind: 'document', id: DOCUMENT }] }],
        },
      ]),
    ).toBe(false)
  })

  it('refuses an empty group, which would be a dropdown with nothing in it', () => {
    expect(validWith([{ kind: 'group', label: 'Empty', items: [] }])).toBe(false)
  })

  it('refuses an address link with no label, because it has no title to fall back on', () => {
    expect(validWith([{ kind: 'url', href: 'https://example.com' }])).toBe(false)
  })

  it('refuses a target that is not an id', () => {
    expect(validWith([{ kind: 'document', id: 'getting-started' }])).toBe(false)
    expect(validWith([{ kind: 'collection', id: '../../etc' }])).toBe(false)
  })

  it('refuses more items than the header holds, and more links than a dropdown holds', () => {
    const link = { kind: 'document', id: DOCUMENT }
    expect(validWith(Array.from({ length: MAX_PUBLIC_MENU_ITEMS + 1 }, () => link))).toBe(false)
    expect(
      validWith([
        {
          kind: 'group',
          label: 'Many',
          items: Array.from({ length: MAX_PUBLIC_MENU_GROUP_LINKS + 1 }, () => link),
        },
      ]),
    ).toBe(false)
  })

  it('refuses an empty or over-long label', () => {
    expect(validWith([{ kind: 'document', id: DOCUMENT, label: '' }])).toBe(false)
    expect(validWith([{ kind: 'document', id: DOCUMENT, label: 'x'.repeat(61) }])).toBe(false)
  })

  it('refuses fields it does not declare', () => {
    expect(validWith([{ kind: 'document', id: DOCUMENT, onclick: 'x' }])).toBe(false)
  })
})

describe('address links (ADR-011)', () => {
  const accepts = (href: string): boolean =>
    validWith([{ kind: 'url', href, label: 'Link' }]) &&
    new RegExp(PUBLIC_MENU_URL_PATTERN).test(href)

  it.each([
    'https://status.example.com',
    'http://intranet/docs',
    'https://example.com/a?b=c#d',
    '/s/handbook',
    '/',
  ])('accepts %s', (href) => {
    expect(accepts(href)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>',
    'vbscript:msgbox',
    '//evil.example.com',
    'https://example.com@evil.example.com/',
    'https://user:pass@example.com/',
    'https://exa mple.com',
    'ftp://example.com',
    'example.com',
    '',
  ])('refuses %s', (href) => {
    expect(validWith([{ kind: 'url', href, label: 'Link' }])).toBe(false)
  })
})

describe('reading a version 1 document (rule 17)', () => {
  const { publicMenu: _menu, ...rest } = organisation
  const version1 = {
    ...rest,
    version: 1,
    publicNavigation: [
      { label: 'Handbook', href: '/handbook' },
      { label: 'Status', href: 'https://status.example.com' },
    ],
  }

  it('reads it as the current version, every link kept, in order, as an address link', () => {
    const read = parseOrganisationSettings(version1)
    expect(read?.version).toBe(ORGANISATION_SETTINGS_VERSION)
    expect(read?.publicMenu).toEqual([
      { kind: 'url', href: '/handbook', label: 'Handbook' },
      { kind: 'url', href: 'https://status.example.com', label: 'Status' },
    ])
    expect(read).not.toHaveProperty('publicNavigation')
  })

  it('reads a version 1 document with no links as an empty menu', () => {
    expect(parseOrganisationSettings({ ...version1, publicNavigation: [] })?.publicMenu).toEqual([])
  })

  it('still refuses a version 1 document that version 1 itself refused', () => {
    expect(
      parseOrganisationSettings({
        ...version1,
        publicNavigation: [{ label: 'x', href: 'javascript:alert(1)' }],
      }),
    ).toBeNull()
  })

  it('refuses a version 2 shape that claims to be version 1', () => {
    expect(parseOrganisationSettings({ ...organisation, version: 1 })).toBeNull()
  })

  it('upgrades the links themselves with a pure function', () => {
    expect(publicMenuFromNavigation([{ label: 'A', href: '/a' }])).toEqual([
      { kind: 'url', href: '/a', label: 'A' },
    ])
  })
})

describe('menuTargetIds', () => {
  it('collects every document and collection named, once each, groups included', () => {
    const OTHER = '0192f0aa-0000-7000-8000-000000000003'
    expect(
      menuTargetIds([
        { kind: 'document', id: DOCUMENT },
        { kind: 'url', href: '/a', label: 'A' },
        {
          kind: 'group',
          label: 'G',
          items: [
            { kind: 'document', id: DOCUMENT },
            { kind: 'document', id: OTHER },
            { kind: 'collection', id: COLLECTION },
          ],
        },
      ]),
    ).toEqual({ documents: [DOCUMENT, OTHER], collections: [COLLECTION] })
  })
})

describe('whether an external destination sees where the reader came from', () => {
  const external = { kind: 'url', href: 'https://partner.example.com', label: 'Partner' }

  it('accepts hidden and sent on an external link, and nothing else', () => {
    expect(validWith([{ ...external, referrer: 'hidden' }])).toBe(true)
    expect(validWith([{ ...external, referrer: 'sent' }])).toBe(true)
    expect(validWith([external])).toBe(true)
    expect(validWith([{ ...external, referrer: 'origin' }])).toBe(false)
    expect(validWith([{ ...external, referrer: true }])).toBe(false)
  })

  it('refuses it on a link that does not leave the site, rather than ignoring it', () => {
    expect(validWith([{ kind: 'url', href: '/s/handbook', label: 'H', referrer: 'sent' }])).toBe(
      false,
    )
    expect(validWith([{ kind: 'document', id: DOCUMENT, referrer: 'sent' }])).toBe(false)
    expect(validWith([{ kind: 'collection', id: COLLECTION, referrer: 'hidden' }])).toBe(false)
  })
})
