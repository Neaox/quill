# Personas

The actors the product is designed for. Each one has goals, hard limits, and a
set of surfaces it meets. The limits matter as much as the goals: most of what
the permission model (ADR-012) and the public site (ADR-023) do is stop a
persona from reaching something.

## One person is several personas

These are roles in a situation, not accounts. The same engineer is a reader at
nine in the morning, a writer at eleven, and an external reader that evening
when a colleague sends a share link to their personal phone. A workspace lead
is also a writer, and usually the busiest one.

ADR-028 says the same thing about reading and writing. A person is a reader on
the reading and presenting surfaces and a writer in the editor. That is a
**lens applied per view**, not a second account and not a preference toggle.
The question is asked of every view and every state as it is designed: *would a
reader and a writer want to see something different here?* Sometimes yes — a
larger reading size must not enlarge the editor, and a writer wants lock and
autosave status where a reader wants a clean page. Often no, and then there is
one answer for both.

So nothing below should be read as "this user gets this build of the product".
Everyone gets the same product; what differs is what they were granted, and
which surface they are standing on.

## Summary

| Persona | Signed in | Primary surfaces | Ships from |
| --- | --- | --- | --- |
| Organisation: instance administrator | Yes | Signed-in app, settings | M1 |
| Organisation: unit or company administrator | Yes | Signed-in app, settings | M1 |
| Workspace lead | Yes | Signed-in app | M2 |
| Writer | Yes | Editor, reading view | M2 |
| Reader | Yes | Reading view, home, search, presentation | M2 |
| Occasional contributor | Yes | Editor, search | M2 |
| External reader | No (or unknown) | Public site, share links | M3 |
| Crawler or indexer | No | Public site only | M3 |
| Integrator | Token | API | M8 |

---

## The organisation, as a tenant

One deployment serves one organisation (ADR-012, D8). That organisation is a
tree of units of arbitrary depth: companies, departments, teams. Two roles act
on behalf of the organisation itself.

### Instance administrator

The person who stood the instance up, and whoever they hand it to. Distinct
from any workspace owner, deliberately, so that owning a workspace never
implies owning the instance.

**Goals**

- Get from an empty instance to a first unit, workspace, and document without
  reading a guide.
- Set the organisation's identity once, so every workspace looks like the
  organisation.
- Connect the organisation's identity provider and require it for a domain.
- Know who did what: authentication outcomes, permission changes, share links,
  exports, administrative actions.
- Upgrade, back up, and restore with published commands, not folklore.

**Must never be able to**

- Read a private unit's documents by virtue of the role alone. Administration
  is not a reading grant; reaching content still requires a grant that is
  audited.
- Remove a person's own accessibility preferences: colour scheme, reduced
  motion, high contrast (ADR-028, Layer 3).
- Grant the public principal anything above viewer, or write a deny above
  document scope. The `createGrant` use case refuses both.
- See, or recover, a password, a session id, a magic-link token, or a share
  token. All are stored hashed (ADR-011).

**Surfaces:** the signed-in app, instance settings, theme onboarding, the audit
log.

### Unit or company administrator

Runs one branch of the tree — a company inside the group, a department inside
the company. Administers downwards only.

**Goals**

- Create workspaces for the teams below them, and appoint leads.
- Add people to groups and grant roles at the right scope, once, rather than
  document by document.
- Keep their company's documentation private from its sibling companies.
- Set conventions: which templates, which collections, whether workspaces may
  vary their layout, whether share links may be created and up to what role.

**Must never be able to**

- See or grant anything in a sibling unit. Units are private by default; there
  is no implicit read upwards or sideways.
- Change the organisation's identity — colour seeds, shell type, radius,
  density, logo (ADR-028, "who decides what"). A unit inherits identity.
- Publish to the public web where organisation policy forbids it.

**Surfaces:** the signed-in app, unit and workspace settings.

---

## Workspace lead

The person who owns how one workspace is arranged. Usually a tech lead, a
principal engineer, or whoever cares most.

**Goals**

- Shape the workspace: collections, nesting, what the sidebar contains, the
  home document that greets people.
- Move things when they end up in the wrong place, and rename them when the
  team's vocabulary changes, without breaking links. Links are by document id,
  never by path (D17, ADR-031).
- Choose the workspace's layout: navigation as a tree or as collection tabs,
  comments as a panel or as sidenotes, history as a timeline or a menu
  (ADR-028 amendment).
- Set the workspace's templates and required sections.
- Decide what is published, and to whom.

**Must never be able to**

- Change the organisation's identity, or make this workspace look like a
  different product.
- Reach another workspace through this one's sidebar. The navigation sidebar
  shows the current workspace only; search is the single surface that crosses
  workspaces (ADR-028, plan section 15).
- Silently destroy work: a delete is recorded, and revisions survive.

**Surfaces:** the signed-in app, workspace settings, the editor.

---

## Writer

Anyone producing documentation, most days or most weeks.

**Goals**

- Open a document and start typing. No staging, no commit, no branch, no push
  — those words do not appear in the product (plan section 9).
- Never lose work: autosave, local recovery, and a lock that is honest about
  who holds it (ADR-021).
- Get code, tables, callouts, images, and diagrams to look right without
  styling anything.
- Start from a template when there is one, and ignore it when there is not.
  Required sections are shown, not enforced (ADR-029).
- Publish, and have that be the whole of version control.

**Must never be able to**

- Overwrite another person's live editing session. A write without a valid,
  unexpired lock is refused with `423 lock_lost`.
- Publish over a base they never edited from. A stale base is refused, and a
  moved base goes through a three-way merge with a merge view on conflict
  (ADR-015).
- Publish a draft to the public site by accident. Publication is a grant, made
  deliberately, not a side effect of saving.
- Write raw HTML that executes. Markdown is sanitised on the server before it
  is cached (ADR-011).

**Surfaces:** the editor, the reading view, history and compare, presentation
mode.

---

## Reader, signed in

The largest group by far, and the one the north star is written for.

**Goals**

- Get back to yesterday's document in two clicks or fewer.
- See what changed in their workspaces since they last looked.
- Read a thirty-page document comfortably, with a table of contents, working
  heading anchors, and their own choice of light or dark.
- Read it just as comfortably on a phone.
- Find the runbook during an incident, by a half-remembered phrase.
- Trust what they find: who owns it, when it last changed, which revision.

**Must never be able to**

- See a draft. Only published revisions are readable; drafts belong to the
  writer and live outside the content store entirely (D6).
- See a title they have no grant for. Search results are filtered through the
  materialised effective-permission table, so nothing leaks by name.
- Have their reading preferences overridden by a tenant setting.

**Surfaces:** signed-in home, workspace home, the reading view, search,
presentation mode, exports.

---

## Occasional contributor

A developer who edits documentation twice a year, and has forgotten everything
about the product in between. They are the honest test of "simple until
complexity earns its place".

**Goals**

- Find the wrong sentence, usually from a search or a link someone pasted in
  chat.
- Fix it and publish, in under a minute, without learning a workflow.
- Not be asked to choose a template, a status, an owner, or a collection in
  order to change one word.
- Be told plainly if someone else is editing, and what to do about it.

**Must never be able to**

- Be blocked by something they did not know they had to do first. If a required
  section is empty, publish says so and publishes anyway (ADR-029).
- Lose the change because they closed the tab. Unsent changes are kept in
  IndexedDB and resent (ADR-021).
- Be dropped into an interface that assumes yesterday's context. Every surface
  must be legible cold.

**Surfaces:** search, the reading view, the editor.

---

## External reader

A person outside the organisation. A customer reading published documentation,
a supplier following a share link, a candidate reading an engineering
handbook. They may be identified — a share link can carry a password and is
audited per use — or entirely unknown.

**Goals**

- Open the link and get the documentation, not an application.
- Read it immediately, with no account, no sign-up, and no cookie wall.
- Navigate a published collection and search inside it.
- Have the page look the same as it does to the organisation's own people,
  because it is the same renderer under the tenant's theme.

**Must never be able to**

- Reach anything not granted to the public principal or to their share link's
  principal. Every anonymous request holds the public principal, and that
  principal can only ever widen access, never narrow anyone else's (ADR-012
  amendment).
- See drafts, locks, comments, other workspaces, the workspace switcher, or any
  part of the app shell.
- Use an expired, revoked, or password-protected link without the password.
- Enumerate content: public search is scoped to public content and rate
  limited.

**Surfaces:** the public site, share-link pages. Nothing else.

---

## Crawler or indexer

Search engines, LLM crawlers, and the unfurlers behind Slack, Teams, and
similar. Not a person, but a first-class consumer of the public site, and the
reason it is server-rendered at all (ADR-023).

**Needs**

- **Stable URLs.** A published document keeps its address; links are by
  document id underneath, so a rename or a move does not move the page.
- **Server-rendered HTML.** The full text in the first response, from the same
  React reading components the app uses. No client-rendered public pages.
- **Canonical links.** One authoritative address per document, so a share link
  or an alternate path does not fragment the index.
- **A sitemap**, generated and kept current by publish events.
- **Metadata.** Title, description, and Open Graph tags, so an unfurl in a chat
  client shows something worth clicking.
- **Robots rules** that say plainly what may be indexed.
- **No authentication wall.** A public page answers a cold anonymous request
  with the content, not a redirect to sign in.

**Must never be able to**

- See a draft, ever. Drafts are not in the content store, are not rendered on
  any public route, and are not in the sitemap.
- Reach a non-public document by guessing an id or following an internal link.
  Internal links that leave the public set are not emitted as links.
- Follow a share link into content. Share-link routes are `noindex` and carry
  no canonical into the public index.
- Cost the instance more than it is worth: public routes are cached by content
  hash and rate limited.

**Surfaces:** the public site only.

---

## Integrator

CI, a script, or another system acting with a token rather than a browser
session. Later work: the public API with personal tokens arrives in M8, so for
now this persona exists to stop decisions being taken that would exclude it.

**Goals**

- Publish generated documentation from a pipeline.
- Read a document's Markdown and front matter for validation in CI.
- React to a publish through a webhook, rather than polling.
- Keep a repository and a workspace in step, which is Git sync rather than the
  API (M4).

**Must never be able to**

- Exceed the grants of the principal whose token it holds. A token is not a
  new level of access.
- Bypass the resolver. Every route authorises on the server, whoever calls it
  (ADR-011).
- Depend on a field that will vanish. The API is versioned by path and additive
  within a version; the OpenAPI description is diffed in CI (ADR-033).

**Surfaces:** the API.
