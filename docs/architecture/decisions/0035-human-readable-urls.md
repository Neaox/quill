# ADR-035: Human-readable URLs

- **Status:** Accepted (12 September 2026)
- **Deciders:** product owner, maintainers
- **Related:** rule 8 (documents are addressed by id), ADR-023 (public publishing), ADR-033 (compatibility), `docs/design/home.md`

## Context

Links to documents are shared constantly: in chat, in tickets, in commit messages. A link should say what it points to. Today an internal link is `/w/<workspace uuid>/d/<document uuid>`, which says nothing and cannot be read aloud. At the same time, a shared link must keep working after the document is renamed or moved, which is why documents are addressed by a stable id and never by path (rule 8). Confluence resolves this with `pages/<id>/<Title>`; Notion and Stack Overflow with `<title>-<key>`. Both anchor on a stable key and treat the words as advisory.

## Decision

**Internal application URLs** carry a workspace slug and a document reference made of a title slug and a short stable key:

```
/w/engineering/d/authentication-architecture-k7m3q9v2xd
/w/engineering/d/k7m3q9v2xd                    (the words are optional)
```

- **Workspace slug.** Workspaces already have a slug, unique within the instance. The route parameter is the slug; the API gains a lookup by slug. Renaming a workspace's slug keeps the old slug as a redirect for a period (a `workspace_slug_history` table, entries expiring after a year).
- **Short key.** Every document gets a `short_id` at creation: **ten** characters from the Crockford base-32 alphabet (lower-case; no `i`, `l`, `o`, `u`), from 50 random bits through the `IdGenerator` port. It is unique within the **instance**, not the workspace: the instance is a single tenant, the tenant's identity is the host, so workspace slug plus key is the globally unique address, and the key alone still resolves if a document is ever moved to another workspace (the workspace segment is then corrected like a stale title slug). A unique index enforces it and the creation use case regenerates on the rare violation. Sizing: at 40 bits (eight characters) a million documents make a collision near-certain and retries become routine; at 50 bits the odds of any collision among a million documents are about one in two thousand, and the key still fits a chat message or a spoken sentence. It never changes. The UUID remains the primary key and the API's canonical identifier; the short key is a second, stable public handle, and the API accepts either where it takes a document id.
- **Title slug.** Derived from the current title with the existing `slugify`, never stored as identity. When a request's slug does not match the current title, the route redirects (301 on the public site, a router replace in the app) to the canonical form, so stale links keep working and the address bar always shows the current title.
- **Slug construction**, one function (`slugify` in `packages/domain`) for title slugs, document paths, workspace and collection slugs:
  1. Unicode NFKD, then remove combining marks (`\p{Mn}`), so `é` becomes `e` and `ß` stays as the letter it decomposes to.
  2. Lower-case, locale-independent.
  3. Remove apostrophes (`'`, `’`) outright, so *don't* becomes `dont`, not `don-t`.
  4. Every run of anything that is not a letter or a digit (`\p{Letter}`, `\p{Number}`, any script) becomes one hyphen: spaces, punctuation, symbols, emoji, ampersands. Letters in non-Latin scripts are kept; the browser percent-encodes them and shows them readable.
  5. Trim leading and trailing hyphens.
  6. Maximum **80 characters**, cut at the last hyphen before the limit so no word is split, then trimmed again; only when the first word alone exceeds the limit is it cut mid-word.
  7. No stop-word removal, no numbering, no reserved words: predictability beats brevity, and uniqueness is the key's job, not the slug's.
  8. An empty result (a title of only symbols) yields **no slug segment** for a URL (`/d/<key>`); document paths and workspace slugs, which need a name, use their caller's fallback (`untitled`).
- **Key generation.** The `IdGenerator` draws 50 random bits and encodes them; the creation use case inserts and, on a unique-index violation, draws again, bounded at five attempts before failing with an error that names the cause. At ten characters a retry is a once-in-thousands event even across a million documents, so the bound is a safety net, not a cost.
- **Links inside documents** stay canonical (`/d/<uuid>`, ADR-031): that is what the link index and backlinks understand, and it never goes stale. The publish path rewrites any internal `/w/<ws>/d/<ref>` link an author pasted from the address bar into the canonical form by resolving the key, and the renderer emits the readable form for readers, so what people paste and what the store holds converge without anyone thinking about it.
- **Resolution order** for `/d/<ref>`: split on the last `-`; if the tail is a valid short key, resolve by it (and correct the workspace segment if the document lives elsewhere); else if the whole ref is a UUID, resolve by id and redirect to the canonical form; else 404 inside the shell.
- **Link generation** goes through one helper, `documentHref(document)` (and `workspaceHref`), so no component builds a URL by hand; the lint rule `no-inert-control`'s sibling check for string hrefs already discourages ad-hoc links.

**Public site URLs** (ADR-023, M3) are path-shaped for readers and crawlers: `/<site>/<collection-slug>/<title-slug>` with the short key absent, because a public address is a promise. Renames and moves on the public site write a redirect entry (old path → document id) so old links resolve with a 301 to the new path, and the sitemap only ever lists current paths. Share links (ADR-014 §14) keep their opaque tokens.

## Alternatives considered

- **Path-based internal URLs** (`/w/engineering/architecture/authentication-architecture`): the most readable, but every rename or move breaks links unless a redirect table is maintained for internal links too, and rule 8 exists precisely to avoid that. Rejected for the app; adopted, with the redirect table, only for the public site where it earns its cost.
- **UUID plus slug** (`/d/<uuid>/<title>`): stable and readable, but 36 characters of key in the middle of every link. Rejected on readability.
- **Sequential numeric keys** (Confluence's page ids): leak document counts and invite enumeration; a random short key does not.

## Consequences

- One migration: `documents.short_id` (backfilled for existing rows, unique index); `workspace_slug_history`.
- API: `GET /api/workspaces/{idOrSlug}`, document routes accept the short key, DTOs carry `shortId` and `slug`.
- Web: the document route parameter is the reference; the loader resolves and canonicalises; every link is generated by the helper.
- Compatibility (ADR-033): the UUID form keeps resolving for ever; nothing that exists today breaks.
