# Surfaces

The places the product exists. A surface is defined by who reaches it, what
shell it carries, and — most usefully — what must never appear on it.

| Surface | Who reaches it | Authentication | Shell | Ships from |
| --- | --- | --- | --- | --- |
| Signed-in app | Members of the organisation | Required | Full app shell | M1/M2 |
| Public site | Anyone, including crawlers | None | The site's own header | M3 |
| Share-link page | Anyone holding the link | The token (plus a password, optionally) | The reading surface, no app chrome | M3 |
| Presentation mode | Whoever can read the document | As the document requires | Full screen, almost no chrome | M2 |
| Exports | Whoever can read the document | As the document requires | None; the file stands alone | M4 |
| API | Members, and later integrators with tokens | Session, or a token from M8 | None | M1 internal, M8 public |

---

## The signed-in app

The place members work. A single-page application (ADR-023), with three first
pages that answer three different questions (`docs/design/home.md`).

- **Signed-in home** (`/`) answers "where was I, and what changed since?" The
  person is the subject: Continue, Your workspaces, Recently updated, and — for
  an administrator who has not finished — a set-up card that goes away for
  good.
- **Workspace home** (`/w/<workspace>`) answers "what is in this workspace, and
  where do I start?" The workspace's home document is its front page, written
  in the ordinary editor, with fixed sections beneath it.
- **The document surfaces**: reading view, editor, history and compare.

**Must never appear here**

- Another workspace's contents in the sidebar. The sidebar shows the current
  workspace only; the switcher in the top bar moves between them (ADR-028
  amendment). Search is the one surface that crosses workspaces, and it does so
  explicitly, grouped by workspace.
- A document, or a title, the person has no grant for.
- Another person's draft.
- A control that swallows a click. If an action is unavailable the control is
  disabled with a reachable reason; if it is not built, it is not rendered
  (`docs/design/feedback.md`).
- Writer state on a reader's page. Lock and autosave status belong to the
  editor.

## The public site

A published collection at its own address, owned by publishing (M3, ADR-023).
Server-rendered from the same React reading components as the app, cached by
content hash, invalidated by publish events.

Its header is the tenant's: site name, logo, the configurable top links, and
search scoped to the site. Navigation is the published collection's tree.

A signed-in member who opens a public address gets the **public** page, with a
single "Open in the app" affordance, so a link shared outside the organisation
looks the same to everyone.

**Must never appear here**

- Drafts. Only published revisions exist on any public route.
- Anything not granted to the public principal: another collection, a
  non-public document inside a public collection, a title in search results.
- The app shell: no workspace switcher, no sidebar of other workspaces, no
  comment panel, no lock or presence indicator, no account menu.
- A sign-in wall in front of the content. A cold anonymous request is answered
  with the page.
- An unbounded search. Public search covers public content only and is rate
  limited.

## Share-link pages

A token mapped to a grant: scope, role, expiry, optional password, revocation,
creator, and an audit row per use (plan section 14). The reader sees the
document on the reading surface, with no app chrome and nothing beyond the
link's scope.

**Must never appear here**

- Navigation out of the link's scope. A document link grants that document.
- Editing controls, unless the link's role carries them — and comment and edit
  roles are M7, not the first release.
- Indexing. Share-link routes are `noindex` and are not in any sitemap.

## Presentation mode

The same document, the same renderer, different layout tokens (plan section
14). Sections become steps, type scales for a projector, wide and full blocks
take the whole screen. The only chrome is a progress bar, a section rail, and a
presenter bar that fades when idle. Keyboard navigation moves between sections
and a "go to" overlay lists them.

**Must never appear here**

- Presenter notes on the room's screen. `:::notes` is never shown to readers.
- Application chrome: sidebar, switcher, toasts that are not about this
  document.
- Anything that moves under the presenter. The room's screen changes only when
  the presenter changes it.

## Exports

Markdown (single file or a ZIP with assets), HTML, PDF with print styling, and
JSON (plan section 24). An export carries the theme's generated tokens, so it
looks right offline.

**Must never appear here**

- Comments in the Markdown. They are never written into the document, and are
  not part of the Markdown export; a separate JSON export exists for
  completeness (ADR-022).
- Live data without provenance. A live block exports its static rendering with
  an "as of" stamp; a viewer-scoped block is omitted with a note (ADR-032).
- Template scaffolding. Template-only directives never reach a published
  revision, so they cannot reach an export.

## The API

Internal from M1: Fastify routes with schema-validated input, described by
OpenAPI, consumed by a generated client. Public, with personal tokens, in M8.

Every route authorises through the domain resolver on the server. The client
never decides. Object references are ids the resolver checks, so no route
trusts a workspace id taken from a path (ADR-011).

**Must never appear here**

- A response shaped by what the caller asked for rather than what they may
  read.
- A breaking change without a version. The API is versioned by path and
  additive within a version; a non-additive change fails the OpenAPI diff in
  CI (ADR-033).
- A secret in a log line, an audit row, or an error body.
