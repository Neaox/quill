# Share-link API contract

The routes behind "share this document with someone who has no account" (plan section 14; use cases 24–26; ADR-011, ADR-012). The server implements these with TypeBox schemas, so the OpenAPI description and the generated client match this document exactly; if the two disagree, the server's schema wins and this document is corrected.

There are two surfaces here, and they have almost nothing in common.

- **Managing links** is ordinary application API: a session, `manage` on the document, the error shape `{ error: { code, message, details? } }`, and `403` when the caller may not.
- **Reading through a link** is the only unauthenticated, non-public surface the platform has. It takes no session, refuses everything with the same `404`, is rate limited per source address, and carries `X-Robots-Tag: noindex, nofollow`.

## Managing links

| Method and path | Purpose | Response |
|---|---|---|
| `POST /api/documents/:id/share-links` | Create a link for this document | `201 { link: ShareLink, token, url }`; `403 share_links_disabled`; `422 share_link_role_unavailable`; `422 share_link_expiry_in_the_past` |
| `GET /api/documents/:id/share-links` | Every link on this document, newest first | `200 { links: ShareLink[] }` |
| `DELETE /api/share-links/:id` | Revoke a link | `204`; `404` when there is no such link |

All three need **`manage` on the document** — whoever may grant access there may open and close a door into it. `POST` and `DELETE` additionally need a verified email address, like every other write (ADR-011).

```ts
ShareLink = {
  id: string
  documentId: string
  scope: 'document' | 'subtree'
  role: 'viewer'
  expiresAt: string | null      // ISO date-time
  createdBy: string
  createdAt: string
  revokedAt: string | null
  lastUsedAt: string | null     // when the link was last followed
}
```

**Create body**: `{ scope: 'document' | 'subtree', role?: Role, expiresAt?: string | null }`. An omitted, null, or empty `expiresAt` means the link never expires. `role` accepts any of the platform's roles and answers `422 share_link_role_unavailable` with `details.role` for anything but `viewer`: comment and edit links arrive in M7 (plan section 14), and a named refusal is what the share dialog shows.

**The token is returned exactly once**, by `POST`, as `token` (and pre-assembled into `url`, which is `<APP_URL>/share/<token>`). Only its SHA-256 is stored, so no later request — by anyone, holding any permission — can produce it again. `GET` never carries it.

**Revocation is idempotent.** Revoking a link twice answers `204` both times, keeps the instant it was first closed, and audits once.

## Reading through a link

| Method and path | Purpose | Response |
|---|---|---|
| `GET /api/share/:token` | The link's target document | `200 SharedDocument`; `404` |
| `GET /api/share/:token/documents/:id/rendered` | A document inside a subtree link | `200 SharedBody`; `304`; `404` |

```ts
SharedDocument = {
  link: { scope, role, expiresAt: string | null }
  document: { id, shortId, title, slug, updatedAt }
  rendered: { revision, html, outline: OutlineEntry[], slots: string[] }
  children: SharedNode[]        // empty unless the link is a subtree
}

SharedBody = { document, rendered }
SharedNode = { id, shortId, title, slug, children: SharedNode[] }
```

`:id` takes a document's UUID or its short key, with or without the title words in front of it (ADR-035), exactly as `/api/documents/:id` does.

`GET /api/share/:token/documents/:id/rendered` sets an `ETag` of the render-cache key and honours `If-None-Match` (ADR-031). `GET /api/share/:token` does not: its body also carries the link and the navigation, neither of which is part of that key.

### What is not there

Per `docs/product/surfaces.md`:

- **No drafts.** A document with no published revision is a `404`.
- **No lock, no permissions block, no workspace or collection id, no document status.** The response above is the whole of it.
- **No navigation out of the link's scope.** `children` is empty for a document link, and for a subtree link it holds only published documents nested under the target, inside the target's own collection.
- **No index.** Every response carries `X-Robots-Tag: noindex, nofollow`, and share-link routes are in no sitemap.

### Every refusal is the same refusal

`404` with the same body — `{ error: { code: 'not_found', message: 'This link is not valid' } }` — for **all** of:

- a token nobody ever issued;
- an expired link;
- a revoked link;
- a link on an instance where share links have been turned off;
- a document outside the link's scope;
- a document with nothing published;
- a document reference that names nothing.

This is what makes a 256-bit token unguessable in practice as well as in principle (ADR-011: no enumeration). The reasons are told apart inside the application layer, where the audit log reads them, and never on the wire.

### Rate limiting

Both reading routes share one bucket keyed by source address (`share:read`), with the same backing-off window as the authentication endpoints. Guessing a token costs the same budget as following a real one, which is the point.

### The token in the URL

The token is a path segment, because that is what makes a link a link. Two things follow:

- It never reaches a log. `apps/server/src/plugins/logging.ts` redacts `/share/<token>` and `/api/share/<token>` from every request line Fastify writes.
- It never reaches an audit row. Audit records name the link's **id**.

`Referrer-Policy: strict-origin-when-cross-origin` (ADR-011) already keeps the path out of a cross-origin `Referer`.

### Signing in changes nothing

These routes do not read the session cookie at all, so a member who opens a share link sees the share-link page, exactly as a stranger does — the same rule the public site follows.

## Audit

| Event | Written when | `targetId` |
|---|---|---|
| `share_link.created` | A link is created | the link's id |
| `share_link.revoked` | A link is revoked (once; a second revocation writes nothing) | the link's id |
| `share_link.used` | A link is followed for the **first** time | the link's id |

Every use stamps `last_used_at`, which is what "when was this link last used" is actually asking (use case 26). Only the first use writes a row: a row per anonymous read is a log nobody can read and a database write anyone holding a link can make the server do. Metadata carries the document id, the scope, the role, and the expiry — never the token.

## Policy

`SHARE_LINKS=on|off` (default `on`, documented in `.env.example`) decides whether this organisation has share links. It is asked on every creation *and* on every use rather than cached, so turning it off closes the links that already exist as well as refusing new ones.

**TODO(M3):** this moves to the organisation's settings when the settings store lands, along with the maximum role a link may carry (plan section 14). The port it is read through — `ShareLinkPolicy` — does not change.

## What is not built yet

- **A password on a link** (plan section 14, use case 25). The column the first migration shipped is unused; a password arrives with the comment and edit roles in M7 and will be hashed by the current password scheme.
- **Comment and edit links** (M7).
- **The web surface**: the share dialog, the link list, and the share-link page itself.
