import { type Static, Type } from '@sinclair/typebox'

/**
 * The public site's header menu, as the organisation settings file holds it
 * (settings version 2; `docs/architecture/api-contract-settings.md`).
 *
 * An ordered list of at most {@link MAX_PUBLIC_MENU_ITEMS} items, each either
 * a **link** or a **group** — a dropdown with a label and an ordered list of
 * links, one level deep. A link points at one of three things:
 *
 * - **a document, by id** (`kind: document`), or **a collection, by id**
 *   (`kind: collection`). Never by path or title (AGENTS.md rule 8): the menu
 *   is resolved when a page is rendered (`resolvePublicMenu`), so a rename, a
 *   move or a new public address is in the header on the next page anybody
 *   opens without anybody editing the menu. The label is optional and, when
 *   absent, is the target's *current* title;
 * - **an address** (`kind: url`): an absolute `http(s)` URL, or a rooted path
 *   on this site — the one form version 1 had, kept so every version 1 link
 *   still reads. The label is required, because an address has no title.
 *
 * The address pattern is a whitelist (ADR-011). These links are rendered for
 * every anonymous reader, so script in a tenant's menu would be stored XSS on
 * a page nobody signs in to reach: `javascript:`, `data:` and every other
 * scheme are refused, as is protocol-relative `//host`, which reads as a path
 * and is not one, and so is any authority carrying `@` — userinfo is how
 * `https://acme.example@evil.example` reads as Acme and goes elsewhere.
 */

/** `http(s)://` and an authority with no userinfo, then anything but space: an address off this site. */
const EXTERNAL_URL_PATTERN = '^https?://[^\\s/?#@]+(?:[/?#]\\S*)?$'

/** A rooted path on this site, and not protocol-relative `//host`. */
const SITE_PATH_PATTERN = '^/(?!/)\\S*$'

/** Either address an address link may hold: a rooted path, or an external http(s) URL. */
export const PUBLIC_MENU_URL_PATTERN = `^(?:${SITE_PATH_PATTERN.slice(1, -1)}|${EXTERNAL_URL_PATTERN.slice(1, -1)})$`

/** The UUID shape every entity id has (`@quill/domain`'s `ids.ts`). */
const ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

export const MAX_PUBLIC_MENU_ITEMS = 8
export const MAX_PUBLIC_MENU_GROUP_LINKS = 12
export const MAX_PUBLIC_MENU_LABEL_LENGTH = 60
export const MAX_PUBLIC_MENU_URL_LENGTH = 2000

const LabelSchema = Type.String({ minLength: 1, maxLength: MAX_PUBLIC_MENU_LABEL_LENGTH })

const urlHref = (pattern: string) =>
  Type.String({ minLength: 1, maxLength: MAX_PUBLIC_MENU_URL_LENGTH, pattern })

/**
 * Whether an external destination is told the reader came from this site.
 *
 * Absent means `hidden`: `rel="noreferrer"`, ADR-011's default. An
 * administrator may say `sent` for a partner who relies on referral analytics,
 * and even then the destination sees only this site's origin, never the page:
 * the page's `Referrer-Policy` (`strict-origin-when-cross-origin`) is the
 * ceiling, and nothing here loosens it. Private surfaces — the reader preview,
 * share pages — hide it whatever this says. `noopener` is on every external
 * link regardless (`templates/header-menu.ts`'s `externalLinkRel`).
 */
export const ReferrerSchema = Type.Union([Type.Literal('hidden'), Type.Literal('sent')])

/**
 * An address off this site. The only kind of link that may carry `referrer`,
 * because only a link that leaves the site sends one.
 */
const ExternalLinkSchema = Type.Object(
  {
    kind: Type.Literal('url'),
    href: urlHref(EXTERNAL_URL_PATTERN),
    label: LabelSchema,
    referrer: Type.Optional(ReferrerSchema),
  },
  { additionalProperties: false },
)

/** A path on this site; a `referrer` here is refused rather than ignored. */
const SitePathLinkSchema = Type.Object(
  { kind: Type.Literal('url'), href: urlHref(SITE_PATH_PATTERN), label: LabelSchema },
  { additionalProperties: false },
)

const DocumentLinkSchema = Type.Object(
  {
    kind: Type.Literal('document'),
    id: Type.String({ pattern: ID_PATTERN }),
    /** Absent means "the document's current title". */
    label: Type.Optional(LabelSchema),
  },
  { additionalProperties: false },
)

const CollectionLinkSchema = Type.Object(
  {
    kind: Type.Literal('collection'),
    id: Type.String({ pattern: ID_PATTERN }),
    /** Absent means "the collection's current name". */
    label: Type.Optional(LabelSchema),
  },
  { additionalProperties: false },
)

export const PublicMenuLinkSchema = Type.Union([
  DocumentLinkSchema,
  CollectionLinkSchema,
  ExternalLinkSchema,
  SitePathLinkSchema,
])

const GroupSchema = Type.Object(
  {
    kind: Type.Literal('group'),
    label: LabelSchema,
    items: Type.Array(PublicMenuLinkSchema, {
      minItems: 1,
      maxItems: MAX_PUBLIC_MENU_GROUP_LINKS,
    }),
  },
  { additionalProperties: false },
)

export const PublicMenuSchema = Type.Array(
  Type.Union([
    DocumentLinkSchema,
    CollectionLinkSchema,
    ExternalLinkSchema,
    SitePathLinkSchema,
    GroupSchema,
  ]),
  { maxItems: MAX_PUBLIC_MENU_ITEMS },
)

export type PublicMenu = Static<typeof PublicMenuSchema>
export type PublicMenuItem = PublicMenu[number]
export type PublicMenuLink = Static<typeof PublicMenuLinkSchema>
export type PublicMenuGroup = Static<typeof GroupSchema>
export type PublicMenuReferrer = Static<typeof ReferrerSchema>

/** A version 1 link: a label and a rooted path or http(s) address. */
export interface NavigationLinkV1 {
  readonly label: string
  readonly href: string
}

/**
 * Version 1's `publicNavigation`, as the version 2 menu.
 *
 * Every link becomes an address link with the same label and address, in the
 * same order, so a site's header reads exactly as it did. Nothing is guessed:
 * a path that happens to be some document's address today stays a path rather
 * than becoming a reference to that document, because the administrator wrote
 * an address and an address is what they get until they choose otherwise.
 */
export function publicMenuFromNavigation(links: readonly NavigationLinkV1[]): PublicMenu {
  return links.map((link) => ({ kind: 'url', href: link.href, label: link.label }))
}

/** Every link in the menu, standalone or inside a dropdown, in reading order. */
export function* menuLinks(menu: PublicMenu): Generator<PublicMenuLink> {
  for (const item of menu) {
    if (item.kind === 'group') yield* item.items
    else yield item
  }
}

/** The documents and collections the menu names, each once, in first-seen order. */
export function menuTargetIds(menu: PublicMenu): {
  readonly documents: readonly string[]
  readonly collections: readonly string[]
} {
  const documents = new Set<string>()
  const collections = new Set<string>()
  for (const link of menuLinks(menu)) {
    if (link.kind === 'document') documents.add(link.id)
    if (link.kind === 'collection') collections.add(link.id)
  }
  return { documents: [...documents], collections: [...collections] }
}
