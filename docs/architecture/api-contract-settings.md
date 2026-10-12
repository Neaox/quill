# Settings and secrets API contract

The routes an administrator's settings screens use, and the ones theme onboarding, per-workspace layout, the public menu and share-link policy are all built on (ADR-034, ADR-028).

The server implements these with TypeBox schemas, so the OpenAPI description and the generated client match this document exactly; if the two disagree, the server's schema wins and this document is corrected. All routes are under `/api` and use the error shape `{ error: { code, message, details? } }`. All of them require a session except the three that deliver the theme, which every page renders with — share links and the public site included — and which are therefore public ([below](#the-theme-delivered)).

## Where settings live

| Kind | Where | Written by |
| --- | --- | --- |
| Organisation settings | `.quill/organisation.yaml`, in a system workspace of the content store | `PUT /settings/organisation` |
| Workspace settings | `.quill/workspaces/<workspace id>.yaml`, in the same workspace | `PUT /workspaces/:id/settings` |
| Secrets | Postgres, envelope-encrypted | `PUT /settings/secrets/:name` |
| A person's own preferences | Postgres, `person_preferences` ([below](#person-preferences)) | `PUT /me/preferences` |

The system workspace is a workspace to the content store and to nothing else: it has no row in `workspaces`, so no picker lists it, no grant can name it, no document route can reach it, and `/api/workspaces/<system id>/settings` is a `404`.

**Every workspace's settings live in the system workspace, not in the workspace itself.** They are what an organisation decided about that workspace — the layout override exists only while the organisation allows it — so they sit with the organisation's own file: one compare-and-swap domain, one place a restore looks, and an export that carries the configuration as one thing.

## Routes

| Method and path | Who | Purpose | Response |
| --- | --- | --- | --- |
| `GET /settings/organisation` | any session | The organisation's settings, or the defaults | `{ revision: string \| null, settings: OrganisationSettings }` |
| `PUT /settings/organisation` | instance admin | Replace them | `{ revision, settings, report: ThemeReport }`; `409 settings_conflict`; `422 invalid_settings` |
| `GET /workspaces/:idOrSlug/settings` | `view` | A workspace's own settings and what it resolves to | `{ revision: string \| null, settings: WorkspaceSettings, effective: { layout, layoutSource, layoutLocked } }` |
| `PUT /workspaces/:idOrSlug/settings` | `manage` | Replace them | `{ revision, settings }`; `409 settings_conflict`; `409 workspace_layout_locked`; `422 invalid_settings` |
| `GET /settings/secrets` | instance admin | Every secret's name and key id | `Secret[]` |
| `GET /settings/secrets/:name` | instance admin | One secret's metadata | `Secret`; `404` |
| `PUT /settings/secrets/:name` | instance admin | Store or replace its value | body `{ value }` → `Secret`; `422 invalid_secret_name` / `invalid_secret_value` |
| `DELETE /settings/secrets/:name` | instance admin | Remove it | `204`; `404` |
| `GET /settings/organisation/public-menu/targets?document=…&collection=…` | instance admin | Describe the documents and collections a menu names ([below](#the-public-menu)) | `{ targets: PublicMenuTarget[] }`; at most 100 ids of each |
| `GET /settings/organisation/public-menu/collections?q=&limit=` | instance admin | Collections in any workspace whose name contains `q` | `{ collections: PublicMenuCollectionCandidate[] }`; `limit` 1–20, default 8 |

**No response on any of these routes carries a secret's value.** `Secret` is `{ name, keyId, createdAt, rotatedAt, rewrappedAt }` and there is no shape with a value in it, so this is a property of the schema rather than a habit. A secret is decrypted only at the moment of use, inside the server. `rotatedAt` is when an administrator last replaced the value; `rewrappedAt` is when a master-key rotation last re-wrapped its data key, which is a different question and gets a different column.

**Every body refuses what it does not declare.** These routes compile their schemas with an Ajv that neither coerces nor strips, and every body states `additionalProperties: false`, so a field this release does not know is a `400` rather than a success that quietly did something else — which is what a settings screen written against a newer release would otherwise be told. A policy sent as the string `"false"` is a `400` for the same reason. `expectedRevision` must match `^[0-9a-f]{40}$` or be null, so a malformed one is the same `400` whichever content-store backend is configured.

There is no route that rotates the master key. That is an operator's action tied to an environment change, on an instance just restarted with a key it did not have before, so it is a command: `pnpm --filter @quill/server secrets:rotate`.

`PUT /settings/secrets/:name` is how an instance administrator enters a secret from inside the product; `pnpm --filter @quill/server secrets:set <name>` is the same write from an operator's shell, for a secret an administrator cannot yet reach through the UI (an OIDC provider's own client secret, entered before anyone can sign in to reach a settings screen at all) or a deployment script. Both call the same `setSecret` use case, and the value is read from stdin on the command line — never `argv` — so it never appears in shell history or a process listing. `OIDC_<ID>_CLIENT_SECRET` and `SMTP_PASS` name the two secrets this exists for today (`oidc/<id>/client-secret`, `smtp/password`): each is read from the environment only as a fallback for one release, resolved through `getSecret` at the moment of use rather than held anywhere in `ServerConfig`.

Reading the organisation's settings needs only a session, because every screen renders with the theme, the menu and the policies in them. Changing them is instance administration. A workspace's settings follow the workspace: `view` to read, `manage` to change.

## The theme, delivered

ADR-028's "Delivery": the organisation's theme document, rendered by the server into the stylesheet every page wears, so that `@quill/theme`'s generator and doctor never enter a reader's bundle (review 2026-09-13, H1).

| Method and path | Who | Purpose | Response |
| --- | --- | --- | --- |
| `GET /settings/organisation/theme` | anybody | The identity and layout attributes to write on `<html>`, and the stylesheet to link | `{ themeId: string, stylesheetHref: string, attributes: Record<string, string> }`, `Cache-Control: no-cache`; `500 settings_unreadable` |
| `GET /settings/organisation/theme.css` | anybody | The stylesheet | `text/css; charset=utf-8`, strong `ETag`, `Cache-Control: public, no-cache`, `304` on `If-None-Match`; `500 settings_unreadable` |
| `GET /fonts/<file>` | anybody | A face the stylesheet names | `font/woff2`, `Cache-Control: public, max-age=31536000, immutable`; `404` |

- **`themeId`** is the value of `data-theme-id` on `<html>`: the built-in a customised theme was forked from (`theme.base`), or the theme's own id when it is a built-in or was never forked. It is what lets a component's `theme-press:` variant still apply to a customised Press, and it is what the stylesheet is scoped to.
- **`attributes`** are the layout attributes the stylesheet reads from `<html>` rather than from a component: today `data-rules` (`hairline`, `double`, `cards`, and `plain` where the schema has it) and `data-align` (`centre`, `start`). Each is taken from the organisation's `layout.default` if it states that axis, else from the theme's `variants`, and is absent when neither does. Values pass through as the schema allows them, provided they are a bare lower-case word; the axis list is `PAGE_LAYOUT_AXES` in `apps/server/src/theme/page-attributes.ts`. A workspace's own layout override still belongs on that workspace's shell; this is the organisation's default for every page.
- **`stylesheetHref`** is `/api/settings/organisation/theme.css?v=<hash>`. The `v` is a cache key and nothing else — the route ignores it and always answers the organisation's current theme — so a saved theme is a new address, and an application that swaps the link gets the new sheet without a reload.
- **The stylesheet** is exactly what the generator writes for the built-ins in `packages/ui/src/styles/generated`: light at the root, dark under `prefers-color-scheme` unless the reader chose light, then the explicit `data-theme='dark'` and `'light'` blocks; then the `@font-face` rules for the faces the theme names. Every block is scoped to `html:root[data-theme-id='<themeId>']`, one type selector more specific than the bundle's own `:root[data-theme-id=…]`, so it wins over the built-in it was forked from whichever stylesheet the browser met first. Its `ETag` is the first 32 hex characters of the SHA-256 of the CSS itself, the same value as `<hash>` in `stylesheetHref`. `no-cache` means the browser keeps it and asks before each use: the answer is an empty `304` until somebody saves a theme, and the next page anybody opens after that is in the new one.
- **The faces** are the curated set (`@quill/theme`'s `CURATED_FACE_FILES`, held to `packages/ui/src/styles/fonts.css` by a test), served from the Fontsource packages the application bundles, each at `<file stem>.<16 hex of its SHA-256>.woff2`. Addressed by content, so they are immutable; a name that is not one of them is a `404`. An uploaded face is declared only when its `url` is a rooted path on this origin, because `font-src 'self'` would refuse anything else. Nothing a tenant typed can leave the declaration it is written into: a family name or an upload's address is a CSS string with every quote, backslash and line end escaped, and a token override that could end its declaration, its block or a string, or open a comment, is not used — the generated value stands.

**Why these are public.** Reading the organisation's settings needs a session because they hold the policies and the menu. The theme is not like them: every public page and every share link is rendered with it, and neither has a session, so whatever these routes answer is already published to anybody who opens either. They answer with what the generator made of the theme and nothing more — no name, no revision, no policy — read no cookie, and count against the public site's per-address budget (`PUBLIC_SITE_RATE_LIMIT_MAX`). A settings file this release cannot read is `500 settings_unreadable` with no `details` at all, because the caller may be anybody; the application then keeps the built-in identity its bundle carries.

`GET /settings/organisation/theme` is in the OpenAPI description and the generated client. The stylesheet and the faces are not: they are linked, not called.

The public site does not link `theme.css`. Its own stylesheet (`/s/_assets/theme-<hash>.css`, `docs/architecture/public-site.md`) **begins with the same CSS**, byte for byte, so a public page is still one immutable request rather than that and a second one revalidated on every view; it writes the same `data-theme-id` and the same layout attributes on `<html>`.

## The documents

```yaml
# .quill/organisation.yaml
version: 2
name: Acme
logo: # optional; TODO(M3) nothing stores or serves one until attachments land
  hash: <64 hex characters>   # the blob store's SHA-256
  mediaType: image/svg+xml    # or image/png
  alt: Acme
theme: { … }                  # a theme document, packages/theme's schema (ADR-028)
layout:
  default: { comments, history, navigation, header, rules }
  locked: false               # true means workspaces may not override
policies:
  shareLinksAllowed: true
  publicPublishingAllowed: false
  contrastEnforcement: enforced   # or advisory (ADR-028's instance switch)
publicMenu:                   # the public site's header menu, at most eight items
  - { kind: document, id: <document id> }                  # label: its current title
  - { kind: collection, id: <collection id>, label: Guides }
  - { kind: url, href: https://status.acme.example, label: Status }
  - { kind: url, href: https://partner.example, label: Partner, referrer: sent }   # default hidden
  - kind: group               # a dropdown, one level deep, at most twelve links
    label: Products
    items:
      - { kind: document, id: <document id>, label: Sync }
```

```yaml
# .quill/workspaces/<workspace id>.yaml
version: 1
workspaceId: <the same id>
layout: { comments, history, navigation, header, rules }   # absent means inherit
```

`layout` is the bounded set of signature variants from ADR-028's amendment: `comments` is `sidenotes` or `panel`; `history` is `timeline` or `menu`; `navigation` is `tabs` or `tree`; `header` is `readout` or `breadcrumb`; `rules` is `double`, `hairline`, `cards` or `plain`. A value outside the set is a `400`, not a warning — the set is bounded on purpose, and adding to it is a design decision.

### The public menu

`publicMenu` is an ordered list of at most eight items. An item is a **link** or a **group** — a dropdown with a `label` and one to twelve links; a group never holds a group.

- A link with `kind: document` or `kind: collection` names its target **by id** (AGENTS.md rule 8) and may carry a `label`; without one it is shown under the target's current title. Because the menu is resolved when a page is rendered (`resolvePublicMenu`, `docs/architecture/public-site.md`), a rename or a move is in the header on the next page with nothing edited here, and a target that is not on the web — or has been deleted — is left out of the header rather than linked to a 404.
- A link with `kind: url` has a required `label` and an `href` that is an absolute `http(s)` URL whose authority carries no `@`, or a rooted path on this site (`PUBLIC_MENU_URL_PATTERN`). These links are rendered for every anonymous reader, so the schemes are a whitelist: `javascript:` and `data:` are refused (script in a tenant's menu is stored XSS on a page nobody signs in to reach), as are protocol-relative `//host`, which reads as a path and is not one, and `user@host`, which is how `https://acme.example@evil.example` reads as Acme and goes elsewhere. An external link always carries `rel="noopener"`, and `noreferrer` too unless it says `referrer: sent` — an optional closed choice, `hidden` (the default) or `sent`, accepted on an external `http(s)` link and refused on any other. `sent` lets a partner's analytics see the site's origin, never the page: every public response's `Referrer-Policy: strict-origin-when-cross-origin` is the ceiling, and the reader preview ignores it (ADR-011, amendment of 2026-10-11).
- Labels are 1–60 characters.

The menu editor asks two read-only routes while somebody builds it, both instance administration. `GET /settings/organisation/public-menu/targets` takes repeated `document` and `collection` ids and answers each one as `{ kind, id, status, title, workspaceName, collectionName, href }`, where `status` is `public` (in the header, at `href`), `not-public` (it exists, but is not on the web, so the link is left out until it is) or `missing` (nothing has the id; `title` and the names are null). Whether a target is public is answered by the same resolution the public site renders with. `GET /settings/organisation/public-menu/collections?q=` finds collections by name across every workspace, for the target combobox, as `{ id, name, workspaceName, isPublic }`; documents are found with `GET /search`, which already crosses workspaces.

**Version 1 is still read.** Version 1 had `publicNavigation: [{ label, href }]` instead, with the same address rule less the `@` refusal. The version 1 reader (`parseOrganisationSettings`) validates a version 1 file against version 1's own frozen schema and lifts it to version 2, every link becoming `{ kind: url, href, label }` in the same order — nothing is guessed, so a path that happens to be some document's address stays a path. The file is rewritten as version 2 the next time anybody saves, so there is no migration to run. A version 1 fixture is in the format corpus (`packages/application/src/settings/corpus/organisation.v1.yaml`) and every release's tests read it. The API is not additive here — `publicNavigation` is gone from the responses and the request body — which ADR-033 allows before version 1 with a changelog entry.

`policies.contrastEnforcement` is ADR-028's instance switch: it changes what the doctor **reports** and never whether a save is accepted (below). It is a policy rather than part of the theme, because it says how strictly *any* theme this organisation saves is judged.

Every document carries a `version` and every reader dispatches on it (ADR-033). A file written by a **newer** release is not read, not overwritten, and not quietly replaced with the defaults: the routes answer `500 settings_unreadable`, because overwriting an administrator's configuration is the most expensive way to recover from a downgrade. The parser's own message goes to the server log and never into the response — it describes a file the caller did not write, and in the YAML case quotes from it. For an **instance administrator** the response carries `details.revision`, which is the one thing needed to act: it is the `expectedRevision` of the `PUT` that overwrites the file, so a downgrade is repaired through the API rather than by editing a repository by hand. Everyone else gets the message and nothing else.

**A settings file never holds a secret value.** Where one belongs it holds a reference — `clientSecret: { secret: 'oidc/entra/client-secret' }` — and the secret itself is a row. That is what makes a settings file safe to copy to another instance: it is complete, and the target instance asks for the secrets it does not have.

## Effective values

`effective` on the workspace route is ADR-028's "who decides what" table already resolved, so no client resolves it itself:

- **Identity** — the theme, the type pairing, the seeds — is the organisation's. A workspace inherits it and may not change it.
- **Layout** is the workspace's, defaulting to the organisation's, unless the organisation locked it. `layoutSource` says which of the two answered.
- **Policies and the public menu** are the organisation's.
- **The person's preferences** — colour scheme, text size, reduced motion, high contrast, how animated images play — are not here at all. They belong to the reader and are applied in the browser, over whatever this returns. No tenant setting can remove them. The ones that follow a person between devices are stored with them ([below](#person-preferences)); the colour scheme belongs to the browser.

## Person preferences

A signed-in person's own settings, which follow them to every device (ADR-034: per-person data lives in Postgres). Any session may read and change its own, and nobody else's; no verified email is needed, because they reach nothing beyond the person themselves (ADR-011).

| Method and path | Who | Purpose | Response |
| --- | --- | --- | --- |
| `GET /me/preferences` | any session | The person's effective preferences, defaults filled in | `PersonPreferences` |
| `PUT /me/preferences` | any session | Replace them | body `{ animatedImages? }` → `PersonPreferences`; `400` for a value or a field this release does not know |

`PersonPreferences` is `{ animatedImages: 'brief' | 'hover' | 'never' }`, every field always present. The body is the whole set: a preference left out returns to its default (`animatedImages: 'brief'`). The body is validated strictly, like the settings routes', so an unknown field is a `400` rather than silently dropped.

Stored as one versioned document per person, `{ version: 1, animatedImages? }`, read through a reader that dispatches on `version` (ADR-033). A new preference is a new optional field, so a release that adds one changes no stored document, and a save from an older release keeps the fields of the same version it does not know.

**Animated images** (ADR-047): play briefly, play on hover only, or never. A person whose system asks for reduced motion always sees a still, whatever this says. The web app applies the effective value as `data-animated-images` on the document element and mirrors it into `localStorage` under `animated-images-preference` (`@quill/ui`, `motion/animated-images.ts`); the public site's script applies the mirrored value before first paint, so the choice follows a member onto their organisation's public site on the same origin.

## Concurrency

A read answers with the revision it read at, and a write states the revision it was based on. The server recovers the file's bytes at that revision and passes them to the content store as the expected value of a compare-and-swap, so:

- a write whose file has changed underneath is **refused**, with `409 settings_conflict`, and never merged — blending two administrators' versions of a policy would produce one neither of them chose;
- a write whose file has *not* changed goes through even though the workspace's revision moved, because the revision moves whenever any settings file changes and two administrators configuring two different workspaces should not collide;
- `expectedRevision: null` means "I read nothing", and conflicts if a file has appeared since.

## The theme doctor is advisory

`PUT /settings/organisation` returns `report`, the theme doctor's verdict on every colour rule in `docs/design/colour-rules.md`: `pass`, `adjusted` with the adjustment named, or `warn` with the reason, plus every place the generator changed what the seeds asked for. It **never refuses the write** (ADR-028: "the doctor advises, it does not block"). `report.enforcedRulesHold` is false when the one rule enforced by default — AA text contrast — did not hold, and the theme editor is where that is put to the administrator, in front of the reason and of `policies.contrastEnforcement`, which makes it advisory. Setting that policy to `advisory` changes `enforced` on the rule and `enforcedRulesHold` on the report; it changes nothing about whether the settings save.

## Versions are a hard edge, on purpose

`version` is a literal and every object refuses fields it does not declare, so a release that adds one optional field writes documents the *previous* release refuses outright. That is the trade ADR-034 records: the alternative — read leniently, drop what you do not know — is how a setting an older server silently discarded becomes a policy nobody chose. It is affordable because the refusal is recoverable, which is what `details.revision` on `settings_unreadable` is for: an administrator overwrites the file, or restores an earlier revision of it, through the API.
