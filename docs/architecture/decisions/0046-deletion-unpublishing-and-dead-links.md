# ADR-046: Deletion, unpublishing and dead links

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-012 (permissions), ADR-014 (content store), ADR-023 (public site), ADR-031 (render caching), ADR-035 (human-readable URLs), ADR-045 (access requests), quill-plan.md section 9 (delete is a commit)

## Context

Links outlive pages. A page gets renamed, moved, deleted, sent back to draft, or taken off the public site, and the links to it live on in chats, tickets, other documents and search engines. Quill already redirects renames and moves (ADR-035), and delete is recoverable through the content store's history (plan section 9). Everything else is missing:
- there is no Trash and no restore window;
- every miss looks the same;
- a reader is never told what happened or where to go instead.

The owner asked for honest answers (404, 410 and 301 where each is true), help finding related pages, a replacement and message on deletion, a restore window, and the same behaviour for unpublished pages. All of it has to leak nothing to people the page was hidden from.

## Decision


Quill answers dead links honestly, and helps the reader find what they were after.

**Status codes.**
- **301** for an address that moved, or a deleted page whose author named a replacement the reader can open. Renames and moves already redirect (ADR-035).
- **410 Gone** when Quill knows the page existed and was deliberately removed:
  - **In the app:** a deleted document, known from its tombstone.
  - **On the public site:** a path whose page was **deleted**, known from the site's published-path history. This leaks nothing, since the page was public. Crawlers drop a 410 faster than a 404, which is the point for a page that is gone.
- **404 with an honest reason** when the page still exists but is **withdrawn**: moved back to draft, unpublished from the public site, or carved out of it. It may well come back, so telling crawlers "gone forever" would be wrong. See "Unpublished pages" below.
- **404** for an address that never existed.
- **Guessable addresses** keep the uniform answer above.

**A deleted page keeps the original's access restrictions.** Everything about a deleted page is visible only to the people who could read the page when it was deleted. That covers that it was deleted, its title, the replacement, the message, and the suggestions drawn from it. Everyone else gets exactly what they would have got before the deletion: the "You need access to this page" refusal, or the deny page.
- A request made there is accepted like any other.
- It closes as moot, telling the requester only that it closed.

So a deletion reveals nothing to someone the page was hidden from, and the honest 410 is an answer only for its readers. The same applies on the public site: a page that was public answers 410 publicly; a page that never was answers as it always did. Restoring a page from the trash restores it with its original grants.

**The trash and its restore window.** Deleting a document moves it to its workspace's **Trash**; it does not erase it.
- **Who can restore.** For the restore window (30 days by default; an organisation can set 7 to 365 days), anyone with `manage` where it lived can restore it from the Trash, or from the 410 page itself. It comes back at its old address, with its old grants, its history, and its comments.
- **Restore lands sensibly.** If its collection was deleted too, the restore offers to put it somewhere else. If its old title is now taken by another page in the same place, both keep their own keys (ADR-035): two pages can share a title, and only the public path needs to be unique, which takes a suffix.
- **The 410 page says when.** Readers who could read the page see "Deleted by Sam on 3 October. It can be restored until 2 November", and the restore button if they may restore.
- **Purge.** When the window ends, the page is purged from the Trash and can no longer be restored from the product.
  - Its content still exists in the content store's history (plan §9: delete is a commit). True erasure, for legal or privacy reasons, is a separate instance-administrator action that rewrites history and is audited.
  - Administrators can also purge one page early, for example something posted by mistake, behind a confirmation.
- **The tombstone outlives the purge.** Old links keep answering honestly with 410, and keep the replacement redirect and the message. It is kept for 1 year after purge by default (configurable, or indefinitely). After that the key answers 404.
- **Events.** `DocumentDeleted`, `DocumentRestored` and `DocumentPurged` go through the outbox. Restoring re-indexes the page and removes its tombstone; purging drops its search entry for good.

**Unpublished pages behave the same way.** A page can also become unavailable without being deleted:
- it is moved back to draft, so it has no published revision, and viewers, who only read published revisions, can no longer see it;
- it is taken off the public site, by unpublishing the site or carving the page out;
- it is withdrawn from a share link's scope.

It is treated exactly like a deletion, except that its status says it may return:
- **The same access restrictions.** Only people who could read the published page when it was withdrawn learn that it was withdrawn, with a snapshot of its readers at that moment, as for a deletion. Everyone else sees exactly what they saw before. Its editors still see and edit the draft as usual.
- **The same optional fields.** The unpublish dialog offers the replacement and the message. For example: "Being rewritten for the new on-call rota; back by Friday", or "Use the incident guide meanwhile". A replacement is followed for readers who can open it.
- **A different status.** 404 with "This page is no longer published", not 410: a withdrawn page is expected to come back. Republishing removes the notice, and the old address works again with no redirect needed.
- **On the public site,** a carved-out or unpublished page answers 404 "No longer published here" to everyone, since it was public. It also follows its replacement if that is published there. A whole site taken down keeps its address (ADR-023) and answers the same for every page.
- **Suggestions** use the same two checks, against the readers-at-withdrawal snapshot.

**Tombstones.** A deleted (or withdrawn) document keeps a tombstone with:
- its key, title, collection, tags and deletion time;
- who could read it at deletion: user ids, plus a public flag (for the "could have seen" check below);
- the optional replacement document id and the optional message.

It is kept as described under the trash and its restore window. A withdrawn page's notice lasts until it is republished or deleted. That is enough to answer honestly and to suggest; it holds no content.

**Deleting with a forwarding address.** The delete dialog offers two optional fields, both editable later from the trash, and both recorded on the tombstone:

- **"Send people to another page instead".** A document picker that links by id (AGENTS.md rule 8), so a later rename or move of the replacement never breaks it.
  - In the **app**, a reader of the original page who can read the replacement gets a 301 to it, with a one-line note: "Redirected from 'Old title', which was deleted". Someone who could not read the original is never redirected: they get the refusal they would have got before.
  - A reader of the original who **cannot** read the replacement gets the 410 page saying it was replaced by a page they don't have access to, with the request form for the replacement (its title withheld as usual).
  - On the **public site**, the old path joins the redirect table pointing at the replacement, but only while the replacement is published there. Otherwise the old path answers 410.
  - Chains are followed up to 5 hops: a replacement that was itself deleted with a replacement is followed. A cycle stops at the first repeat and answers 410.
  - The picker refuses the page itself, and warns if the replacement is in a place fewer people can read ("Some readers of this page can't open the replacement").
  - **A section, not just a page.** The replacement can point to a heading or block inside the target. After choosing a page, the picker lists its headings, and blocks that have anchors (ADR-044). The choice is stored as:
    - the target's id, plus the anchor's **stable block id** when it has one;
    - otherwise the heading's slug **and its text**.

    It is resolved when someone follows the link:
    1. by the block id;
    2. else by the slug;
    3. else by the heading whose text is closest. A heading renamed slightly still matches; a rename that changes it completely falls back to the top of the page.

    The note on arrival says which section was meant ("Redirected from 'Old title' to 'Escalation' in On-call guide").
  - **Fragments on the way in.** A browser never sends the fragment to the server. If the old link had one (`…/old-page#rollback`) and the replacement names no section, the redirect has none either, so the browser carries the reader's fragment over by itself, as HTTP specifies. The app's client-side redirect does the same, and lands on that heading if the replacement has it, else at the top. If the replacement does name a section, its fragment is the author's deliberate choice and takes precedence.
  - **On the public site,** the redirect's `Location` carries the section's public anchor (`#user-content-<slug>`). The redirect table stores the section with the replacement id and re-resolves it on each request, so a renamed heading doesn't break it.
- **"Message for people who follow old links".** Plain text, up to 500 characters, shown on the 410 page. For example: "Merged into the on-call guide; the escalation table is now in section 3."
  - It is shown only to readers who pass check 1 below, since it is about a page they could see.
  - On the public site it is shown only if the page was public, and the dialog says the message will be public.

Both are audited with the deletion, and the dialog's defaults are empty: deleting stays one confirmation for anyone who doesn't need them.

**Suggestions.** A dead link offers up to five pages the reader might have wanted, plus a "Search for …" link. Two checks decide what may be used, and both must pass:
1. **What the reader could have seen.** The deleted page's tags, collection and title may shape the suggestions only if the reader could read that page when it was deleted. At deletion, the tombstone records **who could read it then**:
   - the user ids, with groups expanded to their members at that moment;
   - a flag if it was public, in which case everyone passes.

   This is resolved with ADR-012's functions over the materialised table. Expanding groups once at deletion is exact, and needs no history of group memberships.
   - Access granted after the deletion does not count.
   - Access the reader has since lost does count, for the page's own metadata only. They saw it then, and the title is in their link.
2. **What the reader can see now.** Every suggested page is filtered by the reader's current permissions through the search index, so nothing they cannot open today is ever listed, whatever the deleted page was.
- **Check 1 passes (the reader could read the deleted page, or it was public):**
  - rank by shared tags (most first);
  - then the same collection;
  - then title similarity.
  - The note reads "Pages with the same tags as the deleted one".
- **Check 1 fails (the reader never had access to it, or it never existed):**
  - search only on the words in the address they hold (the title slug, which is theirs already);
  - its tags and collection are never used.
- **Filtering.** Every suggestion is filtered by the reader's permissions through the search index (ADR-010, ADR-012). On the public site that is the public principal, which only ever sees published pages.
- **Restraint.** Nothing is suggested when nothing scores above a minimum, so the page shows no irrelevant suggestions, just search.


## Alternatives considered

- **One uniform "not available" answer for every miss.** It protects nothing for keyed links, since a member can't guess keys and already holds the one they have. It also sends people with a typo or a deleted page into an access request for nothing. It is kept only for guessable addresses (ADR-045).
- **410 for unpublished pages.** It tells crawlers and readers "gone forever" about a page that is expected back. A 404 with an honest notice is accurate.
- **Hard delete with no Trash.** Mistakes are permanent until someone digs through history, which no reader can do.
- **Suggestions from the deleted page for everyone.** That leaks a private page's tags and collection to people who never had access.

## Consequences

- New domain concepts: a tombstone (with its readers snapshot, replacement and message), Trash with a restore window and purge, and a "withdrawn" notice for unpublished pages. They need new outbox events (`DocumentRestored`, `DocumentPurged`, `DocumentWithdrawn`), a purge job, and a published-path history for the public site.
- Delete and unpublish dialogs gain two optional fields.
- End-to-end tests cover:
  - 404, 410 and 301 on both surfaces, and the uniform answer for guessable addresses;
  - a removed page answering a non-reader exactly as before, with no 410, replacement, message or suggestions;
  - suggestions never drawn from a page the reader couldn't read when it was removed, and never listing a page they can't read now, including access gained or lost since;
  - the restore window: restoring from the Trash and from the 410 page, restoring into a deleted collection, purge at the window's end, early purge, and the tombstone outliving the purge;
  - unpublishing (back to draft, carved out, site taken down): a 404 with a notice to past readers only, the replacement and message, and republishing clearing it;
  - delete with a replacement (readable and unreadable, chains, cycles, an unpublished replacement on the public site) and with a message;
  - replacement sections resolved by block id, slug and heading text, and the reader's own fragment carried through a redirect that names no section.

## Delivery

Independent of access requests, and able to ship first:
1. The Trash with its restore window, purge and early purge; tombstones with the readers snapshot.
2. 410, 404 with a notice, and 301 in the app and on the public site, with the public site's published-path history.
3. The delete and unpublish dialogs' replacement and message.
4. Permission-safe suggestions.
