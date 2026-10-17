import { describe, expect, it } from 'vitest'

import type { PublicMenu, PublicMenuLink } from '../../../lib/api/index.ts'
import {
  appendGroup,
  appendLink,
  canMoveTo,
  displayLabel,
  groupsOf,
  hidesReferrer,
  itemIssues,
  labelForAddress,
  looksLikeAddress,
  MAX_GROUP_LINKS,
  MAX_MENU_ITEMS,
  menuIsValid,
  menuTargetIds,
  moveBy,
  moveTo,
  removeAt,
  replaceAt,
  urlError,
  withAddress,
  withReferrerHidden,
} from './menu-model.ts'

const doc = (id: string, label?: string): PublicMenuLink => ({
  kind: 'document',
  id,
  ...(label === undefined ? {} : { label }),
})
const url = (label: string): PublicMenuLink => ({
  kind: 'url',
  href: `https://${label}.test`,
  label,
})

const MENU: PublicMenu = [
  doc('a'),
  { kind: 'group', label: 'Products', items: [doc('b'), doc('c')] },
  url('status'),
]

/** The menu as labels and ids, which is easier to read in a failure than the objects. */
const shape = (menu: PublicMenu): unknown =>
  menu.map((item) =>
    item.kind === 'group'
      ? { [item.label]: item.items.map((link) => (link.kind === 'url' ? link.label : link.id)) }
      : item.kind === 'url'
        ? item.label
        : item.id,
  )

describe('reordering', () => {
  it('moves an item one step up or down within its own list, and nowhere past either end', () => {
    expect(shape(moveBy(MENU, { index: 0 }, 1))).toEqual([{ Products: ['b', 'c'] }, 'a', 'status'])
    expect(shape(moveBy(MENU, { index: 2 }, -1))).toEqual(['a', 'status', { Products: ['b', 'c'] }])
    expect(moveBy(MENU, { index: 0 }, -1)).toBe(MENU)
    expect(moveBy(MENU, { index: 2 }, 1)).toBe(MENU)
    expect(shape(moveBy(MENU, { index: 1, child: 0 }, 1))).toEqual([
      'a',
      { Products: ['c', 'b'] },
      'status',
    ])
    expect(moveBy(MENU, { index: 1, child: 1 }, 1)).toBe(MENU)
  })

  it('drops an item where another one is, counting positions as they were before the move', () => {
    expect(shape(moveTo(MENU, { index: 0 }, { group: null, before: 3 }))).toEqual([
      { Products: ['b', 'c'] },
      'status',
      'a',
    ])
    expect(shape(moveTo(MENU, { index: 2 }, { group: null, before: 0 }))).toEqual([
      'status',
      'a',
      { Products: ['b', 'c'] },
    ])
  })
})

describe('nesting', () => {
  it('moves a standalone link into a dropdown, and back out again', () => {
    const nested = moveTo(MENU, { index: 0 }, { group: 1, before: 1 })
    expect(shape(nested)).toEqual([{ Products: ['b', 'a', 'c'] }, 'status'])
    const lifted = moveTo(nested, { index: 0, child: 1 }, { group: null, before: 2 })
    expect(shape(lifted)).toEqual([{ Products: ['b', 'c'] }, 'status', 'a'])
  })

  it('finds the destination dropdown even when the move shifts it', () => {
    const menu: PublicMenu = [doc('a'), url('x'), { kind: 'group', label: 'G', items: [doc('b')] }]
    expect(shape(moveTo(menu, { index: 0 }, { group: 2, before: 0 }))).toEqual([
      'x',
      { G: ['a', 'b'] },
    ])
  })

  it('never puts a dropdown inside another, or a link into a full one', () => {
    const two: PublicMenu = [...MENU, { kind: 'group', label: 'More', items: [doc('d')] }]
    expect(canMoveTo(two, { index: 3 }, { group: 1, before: 0 })).toBe(false)
    expect(moveTo(two, { index: 3 }, { group: 1, before: 0 })).toBe(two)

    const full: PublicMenu = [
      doc('a'),
      {
        kind: 'group',
        label: 'Full',
        items: Array.from({ length: MAX_GROUP_LINKS }, (_, n) => doc(`f${n}`)),
      },
    ]
    expect(canMoveTo(full, { index: 0 }, { group: 1, before: 0 })).toBe(false)
    // Within the full dropdown, a reorder is still fine.
    expect(canMoveTo(full, { index: 1, child: 0 }, { group: 1, before: 3 })).toBe(true)
  })

  it('lists the dropdowns a link could go into', () => {
    expect(groupsOf(MENU)).toEqual([{ index: 1, label: 'Products' }])
  })
})

describe('adding, replacing and removing', () => {
  it('adds a link at the end of the menu or of a dropdown, within the limits', () => {
    expect(shape(appendLink(MENU, doc('z'), null))).toEqual([
      'a',
      { Products: ['b', 'c'] },
      'status',
      'z',
    ])
    expect(shape(appendLink(MENU, doc('z'), 1))).toEqual([
      'a',
      { Products: ['b', 'c', 'z'] },
      'status',
    ])
    const full = Array.from({ length: MAX_MENU_ITEMS }, (_, n) => doc(`m${n}`))
    expect(appendLink(full, doc('z'), null)).toBe(full)
    expect(appendGroup(full)).toBe(full)
  })

  it('adds an empty dropdown for its label to be typed into', () => {
    expect(appendGroup([]).at(-1)).toEqual({ kind: 'group', label: '', items: [] })
  })

  it('replaces and removes items at the top level and inside a dropdown', () => {
    expect(shape(replaceAt(MENU, { index: 1, child: 0 }, doc('q')))).toEqual([
      'a',
      { Products: ['q', 'c'] },
      'status',
    ])
    expect(shape(removeAt(MENU, { index: 1, child: 1 }))).toEqual([
      'a',
      { Products: ['b'] },
      'status',
    ])
    expect(shape(removeAt(MENU, { index: 1 }))).toEqual(['a', 'status'])
  })
})

describe('validation', () => {
  it('needs a label on an address and a dropdown, and none on a document or collection', () => {
    expect(itemIssues({ kind: 'url', href: 'https://x.test', label: '' }).label).toBeDefined()
    expect(itemIssues({ kind: 'group', label: '', items: [doc('a')] }).label).toBeDefined()
    expect(itemIssues(doc('a')).label).toBeUndefined()
    expect(itemIssues(doc('a', ' ')).label).toBeDefined()
    expect(itemIssues(doc('a', 'x'.repeat(61))).label).toBeDefined()
  })

  it('needs a link in every dropdown', () => {
    expect(itemIssues({ kind: 'group', label: 'G', items: [] }).items).toBeDefined()
    expect(menuIsValid([{ kind: 'group', label: 'G', items: [] }])).toBe(false)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.test',
    'https://a@evil.test',
    'ftp://x',
  ])('refuses the address %s', (href) => {
    expect(urlError(href)).toBeDefined()
  })

  it.each(['https://status.example.com', 'http://intranet/docs', '/s/handbook'])(
    'accepts the address %s',
    (href) => {
      expect(urlError(href)).toBeUndefined()
    },
  )

  it('is valid when every item and every link inside a dropdown is', () => {
    expect(menuIsValid(MENU)).toBe(true)
    expect(menuIsValid([{ kind: 'group', label: 'G', items: [url('')] }])).toBe(false)
  })
})

describe('targets and labels', () => {
  it('collects each document and collection once, dropdowns included', () => {
    expect(menuTargetIds([...MENU, doc('a'), { kind: 'collection', id: 'k' }])).toEqual({
      documents: ['a', 'b', 'c'],
      collections: ['k'],
    })
  })

  it('shows the custom label, else the target’s current title, else nothing yet', () => {
    const target = {
      kind: 'document' as const,
      id: 'a',
      status: 'public' as const,
      title: 'Getting started',
      workspaceName: 'Engineering',
      collectionName: 'Guides',
      href: '/s/guides/getting-started',
    }
    expect(displayLabel(doc('a', 'Start'), target)).toBe('Start')
    expect(displayLabel(doc('a'), target)).toBe('Getting started')
    expect(displayLabel(doc('a'), undefined)).toBeNull()
  })

  it('starts an address link’s label from its host', () => {
    expect(labelForAddress('https://www.status.example.com/x')).toBe('status.example.com')
    expect(labelForAddress('/s/handbook')).toBe('/s/handbook')
  })

  it('tells an address from a search', () => {
    expect(looksLikeAddress('https://x')).toBe(true)
    expect(looksLikeAddress('/s/x')).toBe(true)
    expect(looksLikeAddress('sync map')).toBe(false)
  })
})

describe('the referrer an external link sends', () => {
  const partner = { kind: 'url' as const, href: 'https://partner.test', label: 'Partner' }

  it('is hidden unless an administrator turns it off, and hiding it drops the field', () => {
    expect(hidesReferrer(partner)).toBe(true)
    const sent = withReferrerHidden(partner, false)
    expect(sent).toEqual({ ...partner, referrer: 'sent' })
    expect(hidesReferrer(sent)).toBe(false)
    expect(withReferrerHidden(sent, true)).toEqual(partner)
  })

  it('is never carried by a path on this site, which the server would refuse', () => {
    const local = { kind: 'url' as const, href: '/s/handbook', label: 'Handbook' }
    expect(withReferrerHidden(local, false)).toEqual(local)
    expect(withAddress(withReferrerHidden(partner, false), '/s/handbook')).toEqual({
      kind: 'url',
      href: '/s/handbook',
      label: 'Partner',
    })
  })

  it('keeps the choice when the external address is edited', () => {
    expect(withAddress(withReferrerHidden(partner, false), 'https://partner.test/x')).toEqual({
      kind: 'url',
      href: 'https://partner.test/x',
      label: 'Partner',
      referrer: 'sent',
    })
  })
})
