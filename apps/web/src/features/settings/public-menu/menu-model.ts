import type {
  MenuTargetIds,
  PublicMenu,
  PublicMenuGroup,
  PublicMenuItem,
  PublicMenuLink,
  PublicMenuTarget,
} from '../../../lib/api/index.ts'

/**
 * The public menu as the editor changes it: pure functions from one menu to
 * the next, so every gesture — a drag, a keyboard move, a nest, a removal —
 * is the same small, tested step whichever control asked for it.
 *
 * The limits and the address rule mirror the server's schema
 * (`@quill/application`'s `settings/public-menu.ts`). The client check is a
 * courtesy that puts the reason beside the field; the server's `422
 * invalid_settings` is the guard.
 */

export const MAX_MENU_ITEMS = 8
export const MAX_GROUP_LINKS = 12
export const MAX_LABEL_LENGTH = 60
export const MAX_URL_LENGTH = 2000

/** `PUBLIC_MENU_URL_PATTERN`: a rooted path, or http(s) with an authority that carries no `@`. */
const URL_PATTERN = /^(?:\/(?!\/)\S*|https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?)$/u

/** Where an item is: a top-level index, and the index inside its dropdown when it is in one. */
export interface MenuPosition {
  readonly index: number
  readonly child?: number | undefined
}

/** Where a moved item lands: before `before` at the top level, or inside dropdown `group`. */
export interface MenuDestination {
  readonly group: number | null
  readonly before: number
}

const isGroup = (item: PublicMenuItem | undefined): item is PublicMenuGroup =>
  item?.kind === 'group'

export function itemAt(menu: PublicMenu, position: MenuPosition): PublicMenuItem | undefined {
  const item = menu[position.index]
  if (position.child === undefined) return item
  return isGroup(item) ? item.items[position.child] : undefined
}

/** The menu with the item at `position` replaced by `next`. */
export function replaceAt(
  menu: PublicMenu,
  position: MenuPosition,
  next: PublicMenuItem,
): PublicMenu {
  if (position.child === undefined) return menu.with(position.index, next)
  const group = menu[position.index]
  if (!isGroup(group) || isGroup(next)) return menu
  return menu.with(position.index, { ...group, items: group.items.with(position.child, next) })
}

export function removeAt(menu: PublicMenu, position: MenuPosition): PublicMenu {
  if (position.child === undefined) return menu.toSpliced(position.index, 1)
  const group = menu[position.index]
  if (!isGroup(group)) return menu
  return menu.with(position.index, { ...group, items: group.items.toSpliced(position.child, 1) })
}

/** Whether the item at `from` may land at `to`: a dropdown never goes inside another. */
export function canMoveTo(menu: PublicMenu, from: MenuPosition, to: MenuDestination): boolean {
  const item = itemAt(menu, from)
  if (item === undefined) return false
  if (to.group === null) {
    return from.child === undefined || menu.length < MAX_MENU_ITEMS
  }
  const group = menu[to.group]
  if (isGroup(item) || !isGroup(group)) return false
  return from.child !== undefined && from.index === to.group
    ? true
    : group.items.length < MAX_GROUP_LINKS
}

/**
 * The item at `from`, moved to `to`. `to.before` is counted in the list as it
 * is *before* the move, so "drop on this row" means "put it where this row is
 * now", whichever list it came from.
 */
export function moveTo(menu: PublicMenu, from: MenuPosition, to: MenuDestination): PublicMenu {
  const item = itemAt(menu, from)
  if (item === undefined || !canMoveTo(menu, from, to)) return menu

  const sameList =
    (to.group === null && from.child === undefined) ||
    (to.group !== null && from.child !== undefined && from.index === to.group)
  const fromIndex = from.child ?? from.index
  const before = sameList && fromIndex < to.before ? to.before - 1 : to.before

  // Take it out first, then put it in. Taking out a top-level item shifts
  // every dropdown after it up by one; taking a link out of a dropdown moves
  // nothing at the top level.
  const without = removeAt(menu, from)
  if (to.group === null) return without.toSpliced(before, 0, item)
  const groupIndex = from.child === undefined && from.index < to.group ? to.group - 1 : to.group
  const group = without[groupIndex]
  if (!isGroup(group) || isGroup(item)) return menu
  return without.with(groupIndex, { ...group, items: group.items.toSpliced(before, 0, item) })
}

/** One step up or down within its own list; nothing at either end. */
export function moveBy(menu: PublicMenu, position: MenuPosition, by: -1 | 1): PublicMenu {
  const own = position.child ?? position.index
  const length = position.child === undefined ? menu.length : siblingsOf(menu, position).length
  const next = own + by
  if (next < 0 || next >= length) return menu
  return moveTo(menu, position, {
    group: position.child === undefined ? null : position.index,
    // `before` counts the list as it is now, so moving down skips past the neighbour.
    before: by === 1 ? next + 1 : next,
  })
}

function siblingsOf(menu: PublicMenu, position: MenuPosition): readonly PublicMenuItem[] {
  if (position.child === undefined) return menu
  const group = menu[position.index]
  return isGroup(group) ? group.items : []
}

/** A link added at the end of the menu, or of dropdown `group`. */
export function appendLink(
  menu: PublicMenu,
  link: PublicMenuLink,
  group: number | null,
): PublicMenu {
  if (group === null) return menu.length >= MAX_MENU_ITEMS ? menu : [...menu, link]
  const target = menu[group]
  if (!isGroup(target) || target.items.length >= MAX_GROUP_LINKS) return menu
  return menu.with(group, { ...target, items: [...target.items, link] })
}

export function appendGroup(menu: PublicMenu): PublicMenu {
  return menu.length >= MAX_MENU_ITEMS ? menu : [...menu, { kind: 'group', label: '', items: [] }]
}

/** The dropdowns a link could be moved into, by top-level index and label. */
export function groupsOf(
  menu: PublicMenu,
): readonly { readonly index: number; readonly label: string }[] {
  return menu.flatMap((item, index) => (isGroup(item) ? [{ index, label: item.label }] : []))
}

// --- Validation ------------------------------------------------------------

export function urlError(href: string): string | undefined {
  if (href.trim() === '') return 'Give the link an address.'
  if (href.length > MAX_URL_LENGTH) return 'That address is too long.'
  if (!URL_PATTERN.test(href)) {
    return 'Use a full https:// address, or a path on this site such as /s/handbook.'
  }
  return undefined
}

/** A label's problem; `required` for an address or a dropdown, which have no title to fall back on. */
export function labelError(label: string | undefined, required: boolean): string | undefined {
  if (label === undefined || label === '') return required ? 'Give it a label.' : undefined
  if (label.trim() === '') return 'A label needs more than spaces.'
  if (label.length > MAX_LABEL_LENGTH) return 'That label is too long.'
  return undefined
}

export interface ItemIssues {
  readonly label?: string | undefined
  readonly href?: string | undefined
  readonly items?: string | undefined
}

export function itemIssues(item: PublicMenuItem): ItemIssues {
  switch (item.kind) {
    case 'url':
      return { label: labelError(item.label, true), href: urlError(item.href) }
    case 'group':
      return {
        label: labelError(item.label, true),
        items: item.items.length === 0 ? 'Add a link to this dropdown, or remove it.' : undefined,
      }
    default:
      return { label: labelError(item.label, false) }
  }
}

const hasIssue = (issues: ItemIssues): boolean => Object.values(issues).some(Boolean)

/** True when every item, and every link in every dropdown, is one the server will accept. */
export function menuIsValid(menu: PublicMenu): boolean {
  return menu.every(
    (item) =>
      !hasIssue(itemIssues(item)) &&
      (item.kind !== 'group' || item.items.every((link) => !hasIssue(itemIssues(link)))),
  )
}

// --- Targets ---------------------------------------------------------------

/** Every link, standalone or in a dropdown, in reading order. */
export function menuLinks(menu: PublicMenu): readonly PublicMenuLink[] {
  return menu.flatMap((item) => (item.kind === 'group' ? item.items : [item]))
}

/** The documents and collections the menu names, for one batched look-up. */
export function menuTargetIds(menu: PublicMenu): MenuTargetIds {
  const links = menuLinks(menu)
  const idsOf = (kind: 'document' | 'collection') => [
    ...new Set(links.flatMap((link) => (link.kind === kind ? [link.id] : []))),
  ]
  return { documents: idsOf('document'), collections: idsOf('collection') }
}

/**
 * What the public header will say for a link: the administrator's label, else
 * the target's current title, else nothing yet (still loading, or gone).
 */
export function displayLabel(
  link: PublicMenuLink,
  target: PublicMenuTarget | undefined,
): string | null {
  if (link.label !== undefined && link.label !== '') return link.label
  if (link.kind === 'url') return null
  return target?.title ?? null
}

/** A label to start an address link with: its host, or the path for one on this site. */
export function labelForAddress(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./u, '').slice(0, MAX_LABEL_LENGTH)
  } catch {
    return href.slice(0, MAX_LABEL_LENGTH)
  }
}

// --- Address links ---------------------------------------------------------

export type AddressLink = Extract<PublicMenuLink, { kind: 'url' }>

/** An address that leaves the site; a rooted path is this site's own. */
export function isExternalAddress(href: string): boolean {
  return /^https?:\/\//iu.test(href)
}

/**
 * Whether the destination is kept from learning the reader came from this
 * site: true unless the administrator turned it off (`referrer: sent`).
 */
export function hidesReferrer(link: AddressLink): boolean {
  return !('referrer' in link) || link.referrer !== 'sent'
}

/**
 * The link with the referrer hidden — the default, so the field is dropped —
 * or sent. Only an external address may carry the field; the server refuses
 * it anywhere else.
 */
export function withReferrerHidden(link: AddressLink, hidden: boolean): AddressLink {
  const { kind, href, label } = link
  return hidden || !isExternalAddress(href)
    ? { kind, href, label }
    : { kind, href, label, referrer: 'sent' }
}

/** The link at a new address, dropping a referrer choice the address can no longer carry. */
export function withAddress(link: AddressLink, href: string): AddressLink {
  return withReferrerHidden({ ...link, href }, hidesReferrer(link))
}

/** Whether what was typed into a link's combobox reads as an address rather than a search. */
export function looksLikeAddress(text: string): boolean {
  return /^(?:https?:\/\/|\/)/iu.test(text.trim())
}
