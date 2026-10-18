# ADR-059: Document properties on every surface

**Status:** Accepted
**Date:** 2026-10-17
**Related:** ADR-005 (front matter), ADR-011 (security), ADR-015 (title from the first heading), ADR-023 (public site), ADR-029 (templates), ADR-031 (render caching), ADR-037 (labels); `docs/design/properties.md`

## Context

A document's front matter states who owns it, its status, its tags and its review cycle (ADR-005). Until now only the editor showed it, as a form above the body. The signed-in reader, the share page and the public site showed none of it, except that the Markdown renderer drew every date in front matter into the cached body as a list of raw key paths (`review.lastReviewed`), which the reading surfaces then mistook for the page's eyebrow.

Those facts are how a reader decides whether to trust a page: is it current, who do I ask, is it a draft or archived. Readers differ in what they may see: an owner is a person, and a share link or the public site is read by outsiders.

## Decision

**One byline, every surface.** Each surface that shows a document shows the same byline under its title: owners, status, type, when it was updated and reviewed, and tags. It is one React component (`DocumentByline` in `@quill/ui`) and one server template (`templates/byline.ts`) with the same markup, styled by one stylesheet (`@quill/design-css/byline.css`).

**The body carries no front matter.** The renderer no longer draws dates from front matter into the body (render version 11). The cached body is the same for every reader (ADR-031). The byline is assembled per request, for the reader in front of it.

**Who sees what.**

| Fact | Signed-in reader | Share link | Public site |
| --- | --- | --- | --- |
| Owners | As people: a verified person's name, never their address; anything else as written | No | No |
| Status | Yes | Yes | Yes, unless `published` |
| Type | Yes | No | No |
| Updated | Yes, relative | No (the page says when the link expires) | In the footer, absolute |
| Last reviewed | Yes, relative | Yes, absolute | Yes, absolute |
| Next review, overdue | Yes | No | No |
| Tags | Links to the workspace's `tag:` search | Words | Links to the site's own search |

The signed-in facts come from the document envelope (`facts`), which is a property of now like the rest of the envelope (ADR-031): someone reading an old revision is told who to ask today. The share and public facts come from the head revision's front matter through `publicDocumentFacts`. A document's facts are read by one pure function in the domain (`documentFacts`), so the server and the editor agree on what a value means. A value the schema rejects is left out of every byline and is flagged in the editor.

**Owners are verified people.** An owner value names a person only when it is the address of an account that has verified that address. Otherwise an account could register someone else's address and put a name of its choosing beside every document that lists it. Names are looked up in one query per page (`findVerifiedByEmails`), never one per owner.

**The people directory is scoped to editing.** `GET /api/documents/:id/people` searches people, or names a list of addresses. It answers only someone who may edit that document, so it cannot be used as an address book of the instance.

**Tags are not labels, and can take a label's colour.** Labels (ADR-037) are inline pills in a document's text. Tags are document-level classification for finding things. A tag whose name is also one of the organisation's labels is drawn with that label's colour dot: the byline marks it with `class="badge" data-label`, and the theme's existing label rule colours it. No new data is involved. Labels are also suggested as tags in the editor.

## Alternatives considered

- **Render the byline into the cached body.** One HTML string everywhere, but it would either show owners to outsiders or need a body per audience, and it would freeze relative dates into a cache.
- **Show owners' addresses.** This is what front matter holds and what Git carries. It exposes people's addresses to everyone who can read a page, and reads worse than a name.
- **Merge tags into labels.** The two have different jobs: inline emphasis versus classification. A label is the organisation's vocabulary set by an administrator; a tag is an author's word.

## Consequences

- The envelope and the share responses gain an additive `facts` field. The public page and the reader preview gain the byline. The render version moves to 11, so cached bodies re-render on next read.
- A future status vocabulary ("In review", "Deprecated") is an ADR-005 amendment. The byline shows whatever status the schema accepts.
- Workspace-wide tag suggestions need a permission-filtered tag facet on the search index. Until that exists, suggestions come from labels and the document itself.

### Amendment (17 October 2026): the lifecycle on every surface

ADR-005's amendment of the same date splits publication from the lifecycle. The byline's "Status" becomes **Lifecycle** (in review, verified, deprecated), and a status from before the split is shown on no surface. Publication is the header pill's, in the application only.

| Fact | Signed-in reader | Share link | Public site |
| --- | --- | --- | --- |
| In review | Yes | Yes | Yes |
| Verified | "Verified by Ada Lovelace · 2 weeks ago"; the verifier named as a person on an owner's terms (a verified address, one batched lookup with the owners) | "Verified · 2 Oct 2026", never who | "Verified · 2 Oct 2026", never who |
| Verification lapsed | "Verification lapsed", beside "Review overdue" | Not claimed: no verification is shown | Not claimed: no verification is shown |
| Deprecated | Lozenge, and the notice under the byline | Lozenge and notice | Lozenge and notice |
| Replacement | Linked at its readable address if the reader may open it, else not mentioned | Linked under the same token if it is inside the link's scope, else not mentioned | Linked at its address on this site if the site shows it, else not mentioned |
| Review due | "Review due in 5 days", a step louder, in the fortnight before | No | No |
| Publication | Header pill: Draft, Published, or "Published, with unpublished changes" (the last only to someone who may edit) | No | No |

**Why the verifier is hidden from outsiders.** A verifier is a person, and this ADR already hides people (owners) from share and public readers. The date is what an outsider needs to judge currency, so the date is shown.

**Why a lapsed verification is simply not claimed outside.** Saying "lapsed" would disclose the organisation's review cadence, which is internal. Saying "verified" would be untrue. So outsiders are told nothing about verification once it lapses. The public page is cached for seconds (`PUBLIC_SITE_CACHE_TTL_MS`), so a lapse shows within one cache lifetime.

**The replacement never leaks.** It is resolved per surface by the rule a link in the body follows (ADR-035, ADR-046): `readableDocuments` for a member, the share link's scope, the site's own pages (`surfaceReplacement`). A page the reader cannot open is not named, linked or counted.

**One notice, every surface.** The notice is `LifecycleNotice` in `@quill/ui` and `templates/lifecycle-notice.ts` on the server, with the same markup, styled by `byline.css` (AGENTS.md rule 16). It is a note (`role="note"`) named "Deprecated" under the byline, so it is found before anything in the body is read.

The consequence above that "a future status vocabulary is an ADR-005 amendment" is now that amendment.
