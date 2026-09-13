# Settings and secrets API contract

The routes an administrator's settings screens use, and the ones theme onboarding, per-workspace layout, public navigation and share-link policy are all built on (ADR-034, ADR-028).

The server implements these with TypeBox schemas, so the OpenAPI description and the generated client match this document exactly; if the two disagree, the server's schema wins and this document is corrected. All routes are under `/api`, require a session, and use the error shape `{ error: { code, message, details? } }`.

## Where settings live

| Kind | Where | Written by |
| --- | --- | --- |
| Organisation settings | `.quill/organisation.yaml`, in a system workspace of the content store | `PUT /settings/organisation` |
| Workspace settings | `.quill/workspaces/<workspace id>.yaml`, in the same workspace | `PUT /workspaces/:id/settings` |
| Secrets | Postgres, envelope-encrypted | `PUT /settings/secrets/:name` |

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

**No response on any of these routes carries a secret's value.** `Secret` is `{ name, keyId, createdAt, rotatedAt, rewrappedAt }` and there is no shape with a value in it, so this is a property of the schema rather than a habit. A secret is decrypted only at the moment of use, inside the server. `rotatedAt` is when an administrator last replaced the value; `rewrappedAt` is when a master-key rotation last re-wrapped its data key, which is a different question and gets a different column.

**Every body refuses what it does not declare.** These routes compile their schemas with an Ajv that neither coerces nor strips, and every body states `additionalProperties: false`, so a field this release does not know is a `400` rather than a success that quietly did something else — which is what a settings screen written against a newer release would otherwise be told. A policy sent as the string `"false"` is a `400` for the same reason. `expectedRevision` must match `^[0-9a-f]{40}# Settings and secrets API contract

The routes an administrator's settings screens use, and the ones theme onboarding, per-workspace layout, public navigation and share-link policy are all built on (ADR-034, ADR-028).

The server implements these with TypeBox schemas, so the OpenAPI description and the generated client match this document exactly; if the two disagree, the server's schema wins and this document is corrected. All routes are under `/api`, require a session, and use the error shape `{ error: { code, message, details? } }`.

## Where settings live

| Kind | Where | Written by |
| --- | --- | --- |
| Organisation settings | `.quill/organisation.yaml`, in a system workspace of the content store | `PUT /settings/organisation` |
| Workspace settings | `.quill/workspaces/<workspace id>.yaml`, in the same workspace | `PUT /workspaces/:id/settings` |
| Secrets | Postgres, envelope-encrypted | `PUT /settings/secrets/:name` |

The system workspace is a workspace to the content store and to nothing else: it has no row in `workspaces`, so no picker lists it, no grant can name it, and no document route can reach it.

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

 or be null, so a malformed one is the same `400` whichever content-store backend is configured.

There is no route that rotates the master key. That is an operator's action tied to an environment change, on an instance just restarted with a key it did not have before, so it is a command: `pnpm --filter @quill/server secrets:rotate`.

Reading the organisation's settings needs only a session, because every screen renders with the theme, the navigation and the policies in them. Changing them is instance administration. A workspace's settings follow the workspace: `view` to read, `manage` to change.

## The documents

```yaml
# .quill/organisation.yaml
version: 1
name: Acme
logo: # optional; TODO(M3) nothing stores or serves one until attachments land
  hash: <64 hex characters>   # the blob store's SHA-256
  mediaType: image/svg+xml    # or image/png
  alt: Acme
theme: { … }                  # a theme document, packages/theme's schema (ADR-028)
layout:
  default: { comments, history, navigation, header, rules }
  locked: false               # true means workspaces may not override
publicNavigation:             # the links beside the site name, at most eight
  - { label: Handbook, href: /handbook }   # a rooted path, or an http(s) URL
policies:
  shareLinksAllowed: true
  publicPublishingAllowed: false
  contrastEnforcement: enforced   # or advisory (ADR-028's instance switch)
```

```yaml
# .quill/workspaces/<workspace id>.yaml
version: 1
workspaceId: <the same id>
layout: { comments, history, navigation, header, rules }   # absent means inherit
```

`layout` is the bounded set of signature variants from ADR-028's amendment: `comments` is `sidenotes` or `panel`; `history` is `timeline` or `menu`; `navigation` is `tabs` or `tree`; `header` is `readout` or `breadcrumb`; `rules` is `double`, `hairline` or `cards`. A value outside the set is a `400`, not a warning — the set is bounded on purpose, and adding to it is a design decision.

`publicNavigation[].href` is a rooted relative path (`/handbook`) or an absolute `http(s)` address, and nothing else. These links are rendered into the public site's header for every anonymous reader, so `javascript:` and `data:` are refused — script in a tenant's navigation bar is stored XSS on a page nobody has to sign in to reach — and so is protocol-relative `//host`, which reads as a path and is not one.

`policies.contrastEnforcement` is ADR-028's instance switch: it changes what the doctor **reports** and never whether a save is accepted (below). It is a policy rather than part of the theme, because it says how strictly *any* theme this organisation saves is judged.

Every document carries a `version` and every reader dispatches on it (ADR-033). A file written by a **newer** release is not read, not overwritten, and not quietly replaced with the defaults: the routes answer `500 settings_unreadable`, because overwriting an administrator's configuration is the most expensive way to recover from a downgrade. The parser's own message goes to the server log and never into the response — it describes a file the caller did not write, and in the YAML case quotes from it. For an **instance administrator** the response carries `details.revision`, which is the one thing needed to act: it is the `expectedRevision` of the `PUT` that overwrites the file, so a downgrade is repaired through the API rather than by editing a repository by hand. Everyone else gets the message and nothing else.

**A settings file never holds a secret value.** Where one belongs it holds a reference — `clientSecret: { secret: 'oidc/entra/client-secret' }` — and the secret itself is a row. That is what makes a settings file safe to copy to another instance: it is complete, and the target instance asks for the secrets it does not have.

## Effective values

`effective` on the workspace route is ADR-028's "who decides what" table already resolved, so no client resolves it itself:

- **Identity** — the theme, the type pairing, the seeds — is the organisation's. A workspace inherits it and may not change it.
- **Layout** is the workspace's, defaulting to the organisation's, unless the organisation locked it. `layoutSource` says which of the two answered.
- **Policies and public navigation** are the organisation's.
- **The person's preferences** — colour scheme, text size, reduced motion, high contrast — are not here at all. They belong to the reader and are applied in the browser, over whatever this returns. No tenant setting can remove them.

## Concurrency

A read answers with the revision it read at, and a write states the revision it was based on. The server recovers the file's bytes at that revision and passes them to the content store as the expected value of a compare-and-swap, so:

- a write whose file has changed underneath is **refused**, with `409 settings_conflict`, and never merged — blending two administrators' versions of a policy would produce one neither of them chose;
- a write whose file has *not* changed goes through even though the workspace's revision moved, because the revision moves whenever any settings file changes and two administrators configuring two different workspaces should not collide;
- `expectedRevision: null` means "I read nothing", and conflicts if a file has appeared since.

## The theme doctor is advisory

`PUT /settings/organisation` returns `report`, the theme doctor's verdict on every colour rule in `docs/design/colour-rules.md`: `pass`, `adjusted` with the adjustment named, or `warn` with the reason, plus every place the generator changed what the seeds asked for. It **never refuses the write** (ADR-028: "the doctor advises, it does not block"). `report.enforcedRulesHold` is false when the one rule enforced by default — AA text contrast — did not hold, and the theme editor is where that is put to the administrator, in front of the reason and of `policies.contrastEnforcement`, which makes it advisory. Setting that policy to `advisory` changes `enforced` on the rule and `enforcedRulesHold` on the report; it changes nothing about whether the settings save.

## Versions are a hard edge, on purpose

`version` is a literal and every object refuses fields it does not declare, so a release that adds one optional field writes documents the *previous* release refuses outright. That is the trade ADR-034 records: the alternative — read leniently, drop what you do not know — is how a setting an older server silently discarded becomes a policy nobody chose. It is affordable because the refusal is recoverable, which is what `details.revision` on `settings_unreadable` is for: an administrator overwrites the file, or restores an earlier revision of it, through the API.
