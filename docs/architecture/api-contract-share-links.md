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

`DELETE` answers `404` only when there is no such link. A link that exists and whose document the caller may not manage answers **`403`**, consistent with the rest of the authenticated document surface: the caller is already known, so there is nothing to enumerate. The identical `404`s belong to the anonymous surface below, where the caller is not.

```ts
ShareLink = {
  id: string
  documentId: string
  scope: 'document' | 'subtree'
  role: Role                    // today always 'viewer'
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

`GET /api/share/:token/documents/:id/rendered` sets an `ETag` of the render-cache key and honours `If-None-Match` (ADR-031) on an **exact match**, which is what a client that was handed the tag sends back. A weak validator (`W/"..."`) and a comma-separated list of tags are not honoured: the body is re-sent, which is correct if wasteful, and no client of this API produces either. `GET /api/share/:token` sets no tag: its body also carries the link and the navigation, neither of which is part of that key.

A subtree link's scope is resolved against the tree **on every request**, never against the tree as it was when the link was made — so moving a document out from under the target closes it to that link at once, with the same `404` as everything else.

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
- a link carrying a role this release does not have — a comment or edit link written by a newer one is refused rather than read down to a view link;
- a link on an instance where share links have been turned off;
- a document outside the link's scope;
- a document with nothing published;
- a document reference that names nothing;
- **a document the platform cannot place in the tenancy tree at all.** Through the application that is a `500` carrying `details`, which is the right answer to a member and exactly the wrong one here: it would confirm the document exists and say something about how it is filed. On this surface it is the same `404`, and the failure is written to the server log instead, where a defect belongs.

This is what makes a 256-bit token unguessable in practice as well as in principle (ADR-011: no enumeration). The reasons are told apart inside the application layer, where the audit log reads them, and never on the wire.

### Rate limiting

Both reading routes share one bucket keyed by source address (`share:read`), with the same backing-off window as the authentication endpoints. Guessing a token costs the same budget as following a real one, which is the point.

### The token in the URL

The token is a path segment, because that is what makes a link a link. Two things follow:

- It never reaches a log, and never reaches a response body that echoes a URL. `apps/server/src/plugins/logging.ts` redacts `/share/<token>` and `/api/share/<token>`, and that redaction is applied both to every request line Fastify writes and to the not-found handler's message — a trailing slash, or the page address itself, is enough to miss every route and land there.
- It remains visible to whatever sits in **front** of the application: a reverse proxy, a CDN, an egress log. That is a property of putting a capability in a URL rather than something the application can take back, which is why a link is expirable, revocable, and audited on every use (ADR-011).
- It never reaches an audit row. Audit records name the link's **id**.

`Referrer-Policy: strict-origin-when-cross-origin` (ADR-011) already keeps the path out of a cross-origin `Referer`.

### Signing in changes nothing

These routes do not read the session cookie at all, so a member who opens a share link sees the share-link page, exactly as a stranger does — the same rule the public site follows. An instance administrator holding a document-scoped link gets that one document, and the same `404` as a stranger for anything else, even though the same request through `/api/documents/:id` would succeed.

### Denies, and which door they close

ADR-012's amendment makes a deny on a **channel** close that channel and nothing else, and a deny on a **person** hold whichever door they came through. Both show up here:

- A document carved out of a public collection by a deny on the `public` principal is **still readable through a subtree share link**. That deny closed the public web, which is what an administrator asked for; it says nothing about a link somebody was deliberately given.
- A deny on a **user or a group** does protect a document from that person however they reach it — but a share link is not a person, so a link handed to somebody outside the organisation is unaffected by it.
- To take one document off a share link, deny **that link** at that document. It closes that link and leaves every member who reaches the document through their own grant untouched.

## Audit

| Event | Written when | `targetId` |
|---|---|---|
| `share_link.created` | A link is created | the link's id |
| `share_link.revoked` | A link is revoked (once; a second revocation writes nothing) | the link's id |
| `share_link.used` | A link is followed — **every** time, on either reading route | the link's id |

"Every use is audited" is the registered decision (plan section 14; ADR-011; use case 25: *given any use, when the audit log is read, then that use is recorded*), so there is a row per read rather than a row per link. What bounds how many rows a link can produce is the **rate limit on the reading surface** — one bucket per source address, with the same backing-off window as the authentication endpoints — not a rule about which uses count. A read that is refused writes nothing: a use is a use of a link that worked.

A `used` row and the link's `last_used_at` stamp are written in **one transaction**. They are one fact: a stamp without a row loses the use, and a row without a stamp shows an administrator a link nobody has followed.

Metadata carries the document that was actually read — which for a subtree link is not the link's target — the scope, the role, and the source address **as a SHA-256 digest**. The digest answers "how many places is this being read from" without an export being a list of who was where. It is a pseudonym and not a secret: an IPv4 space is small enough to walk, so it narrows what an export discloses rather than making disclosure impossible. The token is in no row.

## Policy

`SHARE_LINKS=on|off` (default `on`, documented in `.env.example`) decides whether this organisation has share links. It is asked on every creation *and* on every use rather than cached, so turning it off closes the links that already exist as well as refusing new ones.

**TODO(M3):** this moves to the organisation's settings when the settings store lands, along with the maximum role a link may carry (plan section 14). The port it is read through — `ShareLinkPolicy` — does not change.

## What is not built yet

- **A password on a link** (plan section 14, use case 25). The column the first migration shipped is unused; a password arrives with the comment and edit roles in M7 and will be hashed by the current password scheme.
- **Comment and edit links** (M7).
- **The web surface**: the share dialog, the link list, and the share-link page itself.
