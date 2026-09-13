# Use cases

Forty-two use cases, grouped by persona and situation. Each one names the job,
the flow as the person experiences it, acceptance criteria an end-to-end
journey can assert, the milestone that ships it, and the spec that proves it.

Read [`personas.md`](personas.md) first for who these people are, and
[`surfaces.md`](surfaces.md) for where they stand.

## Status legend

Status is taken from the plan's Delivery status table, which is authoritative.

| Mark | Meaning |
| --- | --- |
| **Built** | Working through the interface today |
| **In progress** | Partly built; named in its milestone's remainder in the plan |
| **Planned** | Designed and decided, not started |

## Index

| # | Use case | Persona | Situation | Milestone | Status | Journey |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Stand up the instance | Instance admin | Signed in, internal | M1 | Built | `auth.spec.ts` |
| 2 | Create an organisational unit | Unit admin | Signed in, internal | M2 | Built | `organise.spec.ts` |
| 3 | Create a workspace | Unit admin | Signed in, internal | M2 | Built | `organise.spec.ts` |
| 4 | Invite a person and grant a role | Instance or unit admin | Signed in, internal | M2 | In progress | `administer.spec.ts` |
| 5 | Keep one company private from another | Unit admin | Signed in, internal | M1 | Built (API) | `permissions.spec.ts` |
| 6 | Create a collection | Workspace lead | Signed in, internal | M2 | Built | `organise.spec.ts` |
| 7 | Create a document and nest a child | Workspace lead, writer | Signed in, internal | M2 | Built | `documents.spec.ts`, `organise.spec.ts` |
| 8 | Rename a document or collection | Workspace lead | Signed in, internal | M2 | Built (one defect) | `organise.spec.ts` |
| 9 | Move a document | Workspace lead | Signed in, internal | M2 | Built | `organise.spec.ts` |
| 10 | Delete a document and an empty collection | Workspace lead | Signed in, internal | M2 | Built | `organise.spec.ts` |
| 11 | Write a draft with autosave | Writer | Signed in, internal | M2 | Built | `journey.spec.ts` |
| 12 | Start from a template | Writer | Signed in, internal | M2 / M5 | Built / planned | `templates.spec.ts` |
| 13 | Meet another writer's lock | Writer | Signed in, internal | M2 | Built | `locking.spec.ts` |
| 14 | Publish a revision | Writer | Signed in, internal | M2 | Built | `journey.spec.ts` |
| 15 | Publish over a changed base | Writer | Signed in, internal | M2 | Built (API) | `merge.spec.ts` |
| 16 | Fix a typo after six months | Occasional contributor | Signed in, internal | M2 | Built | `contribute.spec.ts` |
| 17 | Pick up where I left off | Reader, writer | Signed in, internal | M2 | Built | `home.spec.ts` |
| 18 | Start from a workspace's front page | Reader | Signed in, internal | M2 | Built | `home.spec.ts` |
| 19 | Read a long document | Reader | Signed in, internal | M2 | Built | `journey.spec.ts`, `design.spec.ts` |
| 20 | Find the runbook during an incident | Reader | Signed in, internal | M3 | Built | `search.spec.ts` |
| 21 | Present to a room | Writer, reader | Signed in, internal | M2 | In progress | `present.spec.ts` |
| 22 | Capture a note for later while presenting | Writer | Signed in, internal | M4 | Planned | `present.spec.ts` |
| 23 | Compare two revisions and restore one | Writer, workspace lead | Signed in, internal | M2 | Built | `journey.spec.ts` |
| 24 | Share a document outside the organisation | Writer, workspace lead | Signed in, outbound | M3 | Built | `share.spec.ts` |
| 25 | Open a share link with no account | External reader | Not signed in, external | M3 | Built | `share.spec.ts` |
| 26 | Revoke a share link | Workspace lead | Signed in, internal | M3 | Built | `share.spec.ts` |
| 27 | Publish a collection to the public web | Workspace lead, unit admin | Signed in, outbound | M3 | Planned | `publish-public.spec.ts` |
| 28 | Read the public site with no account | External reader | Not signed in, public | M3 | Planned | `publish-public.spec.ts` |
| 29 | Index and unfurl the public site | Crawler | Not signed in, public | M3 | Planned | `crawler.spec.ts` |
| 30 | Take one document off the public web | Workspace lead | Signed in, internal | M3 | Planned | `publish-public.spec.ts` |
| 31 | Comment inline and resolve | Reader, writer | Signed in, internal | M4 | Planned | `comments.spec.ts` |
| 32 | Keep comments attached after an outside edit | Writer | Signed in, internal | M4 | Planned | `comments.spec.ts` |
| 33 | Connect a workspace to a repository | Workspace lead | Signed in, internal | M4 | Planned | `sync.spec.ts` |
| 34 | Attach a repository as a read-only source | Workspace lead | Signed in, internal | Idea | Not scheduled | `external-sources.spec.ts` |
| 35 | Give the organisation its identity | Instance admin | Signed in, internal | M3 | Planned | `theme.spec.ts` |
| 36 | Choose a workspace's layout | Workspace lead | Signed in, internal | M3 | Planned | `theme.spec.ts` |
| 37 | Set personal reading preferences | Reader | Signed in, internal | M2 / M3 | Partly built | `design.spec.ts` |
| 38 | Sign in with the organisation's provider | Any member | Signed in, internal | M3 | Built (API); journey to follow | `sso.spec.ts` |
| 39 | Manage sessions and sign out everywhere | Any member | Signed in, internal | M1 | Built (API) | `administer.spec.ts` |
| 40 | Review the audit log | Instance admin | Signed in, internal | M1 / M8 | Events built, UI planned | `administer.spec.ts` |
| 41 | Export a workspace as Markdown | Workspace lead | Signed in, outbound | M4 | Planned | `export.spec.ts` |
| 42 | Publish from CI | Integrator | Token, internal | M8 | Planned | `api.spec.ts` |
| 43 | Put a picture in a document | Writer | Signed in, internal | M2 | Built | `journey.spec.ts` |

---

# Set up an organisation

Signed in, internal. The instance and unit administrators, on day one.

### 1. Stand up the instance

- **Persona:** instance administrator
- **Situation:** a fresh deployment, nobody has an account
- **Job:** get from an empty instance to a signed-in administrator.
- **Milestone:** M1 — **Built**
- **Surfaces:** signed-in app
- **Journey:** `e2e/auth.spec.ts`

**Flow**

1. Open the instance address. It offers sign-up because no account exists.
2. Enter an email and a password of at least twelve characters.
3. Verify the email from the link that arrives.
4. Land on the signed-in home, which shows the set-up card and nothing else,
   because there is nothing else yet.

**Acceptance**

- Given a fresh instance, when the first account is created, then that account
  holds the instance administrator role.
- Given a signed-up account, when it signs in with the right password, then it
  reaches home; and when it signs in with the wrong one, then it stays on the
  page with an error and no hint about whether the email exists.
- Given a signed-in session, when the person signs out, then the session is
  revoked server-side, not only in the browser.

### 2. Create an organisational unit

- **Persona:** instance administrator, unit administrator
- **Situation:** the organisation contains more than one company or department
- **Job:** give a company, department, or team its own private branch of the
  tree.
- **Milestone:** M2 — **Built** (`/admin/organisation`, and the set-up card on
  the signed-in home)
- **Surfaces:** signed-in app, settings
- **Journey:** `e2e/organise.spec.ts`

**Flow**

1. From settings, choose to add a unit.
2. Name it, choose its parent (the instance, or another unit), and label it —
   the label is the organisation's word, not ours.
3. Save. The unit appears in the tree, empty and private.

**Acceptance**

- Given a unit tree of any depth, when a unit is created under a parent, then
  it inherits nothing but the grants that already reach that parent.
- Given two sibling units, when an administrator of one lists workspaces, then
  the other unit's workspaces do not appear.
- Given a unit with children, when it is deleted, then the interface refuses
  until the children are moved or deleted.

### 3. Create a workspace

- **Persona:** instance administrator, unit administrator
- **Situation:** a team needs somewhere to write
- **Job:** create a workspace in a unit, ready to hold collections and
  documents.
- **Milestone:** M2 — **Built**
- **Surfaces:** signed-in app
- **Journey:** `e2e/organise.spec.ts`

**Flow**

1. From home or the workspace switcher, choose to create a workspace.
2. Name it and choose the unit it belongs to.
3. Save. The workspace opens at its home, which already has a home document
   waiting to be written.

**Acceptance**

- Given a person with the right at a unit, when they create a workspace, then
  they land on that workspace's home with the switcher showing it as current.
- Given a new workspace, when its home is opened, then it has a home document
  that anyone with edit can write.
- Given a new workspace, when its sidebar is shown, then it lists this
  workspace's contents only.

### 4. Invite a person and grant a role

- **Persona:** instance administrator, unit administrator
- **Situation:** the team is joining
- **Job:** get a colleague into the right workspaces with the right role, once,
  rather than document by document.
- **Milestone:** M2 — **In progress** (grants and the resolver are built; the
  invitation interface is not)
- **Surfaces:** signed-in app, settings
- **Journey:** `e2e/administer.spec.ts` (planned)

**Flow**

1. Open the unit or workspace's people settings.
2. Invite by email, or add an existing member to a group.
3. Choose a role — viewer, contributor, editor, admin, owner — and the scope it
   applies at.
4. Send. The person receives an invitation, verifies their email, and arrives
   with the access already in place.

**Acceptance**

- Given a grant to a group at a workspace, when a member joins that group, then
  they can read the workspace without any further grant.
- Given a person granted editor at a workspace and viewer at one collection
  inside it, when they open a document in that collection, then they are a
  viewer there and an editor everywhere else in the workspace.
- Given an unverified email, when the person tries to use a grant, then it is
  refused until verification.
- Given any grant change, when it is saved, then an audit row records who
  changed what, at which scope.

### 5. Keep one company private from another

- **Persona:** unit administrator
- **Situation:** two companies share one deployment
- **Job:** be certain that Company B cannot see Company A's documentation.
- **Milestone:** M1 — **Built** through the API; proven by unit tests today
- **Surfaces:** signed-in app, search, API
- **Journey:** `e2e/permissions.spec.ts` (planned)

**Flow**

1. Company A's administrator creates a unit and workspaces under it.
2. Nobody outside that unit is granted anything at it.
3. A member of Company B signs in, opens home, uses the switcher, and searches.

**Acceptance**

- Given no grant at Company A's unit, when a Company B member opens home, then
  no Company A workspace is listed.
- Given no grant, when they search a phrase that appears only in Company A's
  documents, then no result, snippet, or title is returned.
- Given no grant, when they request a Company A document by id, then the answer
  does not distinguish "forbidden" from "does not exist".
- Given a public viewer grant added anywhere, when a signed-in member's access
  is resolved, then it is never lowered by it (ADR-012 amendment).

---

# Organise a workspace

Signed in, internal. This group is the whole of M2's acceptance question.

### 6. Create a collection

- **Persona:** workspace lead
- **Situation:** documents are accumulating without shape
- **Job:** make a first-level container that carries its own grants and publish
  settings.
- **Milestone:** M2 — **Built**
- **Surfaces:** signed-in app
- **Journey:** `e2e/organise.spec.ts`

**Flow**

1. In the workspace sidebar, choose to add a collection.
2. Name it. It appears in the tree, empty.
3. Optionally give it its own colour, and its own grants.

**Acceptance**

- Given a workspace, when a collection is created, then it appears in the tree
  immediately and is selectable as a home for a new document.
- Given a collection with its own viewer grant to a group, when a member of
  that group opens the workspace, then they see the collection and no more.

### 7. Create a document and nest a child under it

- **Persona:** workspace lead, writer
- **Situation:** a topic needs a page, and then a sub-page
- **Job:** put a new document in the right place, and hang a child off it.
- **Milestone:** M2 — **Built**, nesting included
- **Surfaces:** signed-in app, editor
- **Journey:** `e2e/documents.spec.ts` (exists), `e2e/organise.spec.ts`
  (planned)

**Flow**

1. Press "New document".
2. Give it a title and choose its collection; optionally choose a parent
   document and a template.
3. Create. The editor opens on the new document.
4. From the parent's menu in the tree, add a child, which repeats step 2 with
   the parent already chosen.

**Acceptance**

- Given a workspace with collections, when a document is created, then the
  editor opens on it and the tree shows it as the current item.
- Given a document that has never been published, when it is opened for
  reading, then it says plainly that nothing is published yet.
- Given a parent document, when a child is created under it, then the tree
  nests the child and the parent is expandable.
- Given the workspace home, when it is reopened, then the new document is in
  the document list as well as the tree.

### 8. Rename a document or collection

- **Persona:** workspace lead
- **Situation:** the team's vocabulary changed
- **Job:** change a name without breaking anything that points at it.
- **Milestone:** M2 — **Built.** A rename writes the new title into the
  document itself — the front matter `title`, and the first heading when that
  heading is what names it — as well as into the row that indexes it, so the
  publish that follows carries the new name instead of restoring the old one
  (ADR-015).
- **Surfaces:** signed-in app
- **Journey:** `e2e/organise.spec.ts`

**Flow**

1. Open the item's menu in the tree and choose rename.
2. Type the new name and confirm.
3. The tree, the breadcrumb, and the document header update.

**Acceptance**

- Given a document linked from another document, when it is renamed, then the
  link still resolves, because links are by id.
- Given a rename, when the reading view is reloaded, then the new title is the
  heading, the breadcrumb, and the page title — the tree, the breadcrumb and
  the header the moment the rename lands, and the published body with the
  publish that carries it, because publish is the only write to the content
  store (ADR-015).
- Given a rename while somebody else is editing the document, then it is
  refused rather than written over their draft (ADR-021).
- Given a rename, when history is opened, then earlier revisions are still
  there under the same document.

### 9. Move a document

- **Persona:** workspace lead
- **Situation:** something is in the wrong collection, or under the wrong parent
- **Job:** move a document elsewhere in the tree, with its children.
- **Milestone:** M2 — **Built**
- **Surfaces:** signed-in app
- **Journey:** `e2e/organise.spec.ts`

**Flow**

1. Open the item's menu and choose move, or drag it in the tree.
2. Choose the destination collection or parent.
3. Confirm. The tree redraws with the document in its new place.

**Acceptance**

- Given a document with children, when it is moved, then its children move with
  it and keep their order.
- Given a move into a collection with different grants, when a person who could
  read it before opens it, then their access is resolved afresh from the new
  chain, and the interface says so at the point of the move.
- Given a move, when an existing link to the document is followed, then it
  still resolves.
- Given a move, when it is attempted into the document's own subtree, then it
  is refused.

### 10. Delete a document and an empty collection

- **Persona:** workspace lead
- **Situation:** something is finished with
- **Job:** remove a document, and then the collection that held it.
- **Milestone:** M2 — **Built**
- **Surfaces:** signed-in app
- **Journey:** `e2e/organise.spec.ts`

**Flow**

1. Open the item's menu and choose delete.
2. A blocking dialog names what will be deleted, including children.
3. Confirm. The item leaves the tree.
4. With the collection now empty, delete it the same way.

**Acceptance**

- Given a document with children, when delete is chosen, then the dialog names
  the children before anything happens.
- Given a deletion, when the audit log is read, then it records who deleted
  what and when.
- Given a non-empty collection, when delete is chosen, then it is refused with
  the reason on screen.
- Given a deleted document, when its address is opened, then the answer is a
  clean "not found", not an error page.

---

# Write and publish

Signed in, internal. The editor is the surface the product is judged on.

### 11. Write a draft with autosave

- **Persona:** writer
- **Situation:** composing, over minutes or days
- **Job:** write without ever thinking about saving.
- **Milestone:** M2 — **Built**
- **Surfaces:** editor
- **Journey:** `e2e/journey.spec.ts`

**Flow**

1. Open a document and start typing. The lock is acquired silently.
2. Use slash commands for headings, code, tables, callouts, and images.
3. Drag a picture onto the document, paste one from the clipboard, or choose a
   file — see use case 43.
4. Set a block to content, wide, or full width from its menu, and see it at that
   width while writing.
5. Leave. The draft is there on return, at the same point.

**Acceptance**

- Given typing has stopped, when autosave runs, then the inline status says
  saved, in a live region, without a popup.
- Given the browser is closed mid-sentence, when the document is reopened, then
  the unsent change is still there, recovered from local storage.
- Given a block set to wide, when the reading view is opened, then it renders at
  the same width the editor showed.
- Given a draft, when another person opens the document to read, then they see
  the last published revision, never the draft.

### 12. Start from a template

- **Persona:** writer
- **Situation:** writing something the team writes often — an ADR, a runbook
- **Job:** get to a good document quickly, without being trapped by the
  template.
- **Milestone:** M2 for the blocks and schema; **M5** for the gallery,
  built-ins, and template editor (ADR-029) — **Built / planned**
- **Surfaces:** editor
- **Journey:** `e2e/templates.spec.ts` (planned)

**Flow**

1. Choose a template when creating the document.
2. Answer the template's questions. Optional ones can be skipped and answered
   later.
3. The document opens with its sections in place, some marked required, and
   metadata already stamped in front matter.
4. Rename, reorder, or delete any section; add anything anywhere.

**Acceptance**

- Given a template with a conditional section, when its question is answered
  yes, then that section exists in the new document; and no, then it does not.
- Given a required section still holding a placeholder, when the author
  publishes, then the summary names it and the publish succeeds anyway.
- Given a published document, when its Markdown is exported, then no
  template-only directive appears in it.
- Given a document created from a template, when every section is deleted, then
  the document is still valid.

### 13. Meet another writer's lock

- **Persona:** writer, occasional contributor
- **Situation:** two people open the same document
- **Job:** find out immediately that someone else is editing, and not lose
  anything.
- **Milestone:** M2 — **Built** (ADR-021)
- **Surfaces:** editor
- **Journey:** `e2e/locking.spec.ts` (planned; covered by package tests today)

**Flow**

1. Open a document someone else is editing. The editor says who holds it, by
   name, and offers reading instead.
2. Wait. When their lock expires after sixty seconds without a heartbeat, take
   it.
3. If it is urgent and you are a workspace admin, take over the live lock. A
   blocking dialog asks first.
4. The previous holder's editor stops autosaving at once and keeps their
   changes locally, with a recovery path.

**Acceptance**

- Given a document locked by another live session, when a second person opens
  it, then the editor is read-only and names the holder.
- Given a lock whose heartbeats have stopped for sixty seconds, when another
  editor acquires it, then they get it, and nothing swept in the background to
  make that true.
- Given a takeover, when the previous holder's client next writes, then the
  write is refused, autosave stops, and the person is told their changes are
  kept locally.
- Given a failed heartbeat, when one and then two more are missed, then the
  interface escalates rather than assuming the lock is still held.

### 14. Publish a revision

- **Persona:** writer
- **Situation:** the draft is ready
- **Job:** make the change visible to readers, and get a version for free.
- **Milestone:** M2 — **Built**
- **Surfaces:** editor, reading view, history
- **Journey:** `e2e/journey.spec.ts`

**Flow**

1. Press Publish. The button carries the pending state; the label does not
   change.
2. A summary says what is being published, including any unfilled required
   sections.
3. Confirm. A promise toast resolves on the page being looked at.
4. The reading view shows the new content; history has a new entry.

**Acceptance**

- Given a draft, when it is published, then a revision exists in history with
  the author and the time, and the reading view shows the published content.
- Given a publish, when the words stage, commit, branch, push, or merge are
  searched for in the interface, then none of them appear.
- Given another session holding a live lock, when publish is attempted, then it
  is refused rather than silently overwriting.
- Given a publish, when search is next used, then the new content is findable,
  because indexing runs from the publish event.

### 15. Publish over a changed base

- **Persona:** writer
- **Situation:** the document moved on while the draft was open — someone else
  published, or a repository sync arrived
- **Job:** get the change in without losing either side.
- **Milestone:** M2 — **Built** in the content store and API; the merge view is
  part of the remainder
- **Surfaces:** editor
- **Journey:** `e2e/merge.spec.ts` (planned)

**Flow**

1. Press Publish. The base the draft records is behind the store's head.
2. A three-way merge runs on the Markdown. If it succeeds, publishing continues
   and says so.
3. If it conflicts, a merge view shows both sides side by side.
4. Resolve, then publish.

**Acceptance**

- Given a draft based on an older revision, when the changes do not overlap,
  then the merge succeeds and the published revision contains both.
- Given overlapping changes, when publish is attempted, then a merge view
  appears and nothing is written until it is resolved.
- Given a client that asserts a base the draft does not record, when it
  publishes, then the request is refused so the client re-reads.
- Given a merge, when the result is published, then history shows one new
  revision, not a rewritten past.

### 16. Fix a typo after six months

- **Persona:** occasional contributor
- **Situation:** a developer who last edited documentation in the spring
- **Job:** correct one sentence and publish, in under a minute, without
  learning anything.
- **Milestone:** M2 — **Built**
- **Surfaces:** search, reading view, editor
- **Journey:** `e2e/contribute.spec.ts` (planned)

**Flow**

1. Arrive from a link in chat, or search for the wrong phrase.
2. Press Edit on the reading view. The editor opens at the same scroll
   position.
3. Fix the sentence.
4. Press Publish. No template, no status, no owner, no collection is asked for.

**Acceptance**

- Given a published document, when Edit is pressed, then the editor opens
  without any intermediate dialog.
- Given a one-word change, when Publish is pressed, then nothing else is
  required to complete it.
- Given the person has no edit grant, when they open the reading view, then the
  Edit control is not rendered at all.
- Given the document is locked by someone else, when Edit is pressed, then the
  reason is on screen before any typing happens.

### 43. Put a picture in a document

- **Persona:** writer
- **Situation:** writing something that needs a diagram, a screenshot, or a PDF
- **Job:** get the picture into the document without leaving it, and without
  anyone later meeting an image they cannot read.
- **Milestone:** M2 — **Built**
- **Surfaces:** editor, reading view
- **Journey:** `e2e/journey.spec.ts`

**Flow**

1. Drag a file onto the document, paste one from the clipboard, or open the
   image dialog from the slash menu and choose a file.
2. Describe the picture. The dialog will not insert one without alternative
   text, whichever way the file arrived.
3. Press Insert. The button carries the spinner while the file uploads, and the
   image appears at the caret when the server has accepted it.
4. An address on the web is still an option, on the dialog's other panel.
5. Publish. Readers see the picture; it is served from this instance, not from
   wherever it came from.

**Acceptance**

- Given a file the platform does not accept — an SVG, a program renamed `.png` —
  when it is uploaded, then the dialog says what was wrong and the document is
  left as it was, with no broken image in it.
- Given a file larger than the instance's cap, when it is uploaded, then it is
  refused while it is still arriving rather than after it has all been received.
- Given an uploaded picture, when a reader opens the published document, then
  the image loads with no extra sign-in step, and nothing about it can execute.
- Given a photograph carrying where and on what it was taken, when it is
  uploaded, then what readers receive carries neither: the picture is stored
  without its metadata, and the size the platform reports is of what it stored.
- Given a picture whose file is damaged, when it is uploaded, then it is
  refused with what was wrong with it rather than stored unread.
- Given a picture a published document still shows, when someone deletes the
  attachment, then they are told which document shows it and nothing is removed.
- Given a picture two documents happen to share, when one of them deletes it,
  then the other still shows it.

---

# Read daily

Signed in, internal. The largest group of people, and most of the traffic.

### 17. Pick up where I left off

- **Persona:** reader, writer
- **Situation:** opening the app in the morning
- **Job:** get back to yesterday's work in two clicks or fewer.
- **Milestone:** M2 — **Built** (Continue, Your workspaces, Recently updated);
  Recently viewed and Pinned arrive with personal preferences
- **Surfaces:** signed-in home
- **Journey:** `e2e/home.spec.ts` (planned)

**Flow**

1. Open the app. Home shows Continue first: documents you hold a lock on or
   have unpublished draft changes in.
2. Below it, your workspaces, grouped by unit, with the last change in each.
3. Below that, recently updated documents across those workspaces.

**Acceptance**

- Given an unpublished draft, when home is opened, then that document is in
  Continue and one click returns to the editor at it.
- Given an empty section, when home is rendered, then the section is omitted,
  not shown blank.
- Given exactly one visible workspace, when home is opened, then it skips itself
  and opens that workspace.
- Given a workspace the person cannot read, when Recently updated is built,
  then nothing from it appears.

### 18. Start from a workspace's front page

- **Persona:** reader, workspace lead
- **Situation:** new to a team, or new to a topic
- **Job:** understand what a workspace holds and where to begin.
- **Milestone:** M2 — **Built**
- **Surfaces:** workspace home
- **Journey:** `e2e/home.spec.ts` (planned)

**Flow**

1. Choose a workspace from the switcher.
2. Read its home document: the team's own introduction, conventions, and first
   links, written in the ordinary editor.
3. Below it, collections with counts, recently updated, and — for writers — work
   in progress.

**Acceptance**

- Given a workspace, when its home is opened, then the home document renders
  first and is editable by anyone with edit.
- Given the sidebar, when the workspace home is open, then it lists this
  workspace only and no other.
- Given a person with no drafts, when the workspace home renders, then the In
  progress section is absent.

### 19. Read a long document

- **Persona:** reader
- **Situation:** thirty pages of architecture, on a laptop or on a phone
- **Job:** read comfortably, navigate by section, and link a colleague to a
  paragraph.
- **Milestone:** M2 — **Built**
- **Surfaces:** reading view
- **Journey:** `e2e/journey.spec.ts`, `e2e/design.spec.ts`

**Flow**

1. Open the document. The table of contents lists its headings.
2. Jump to a section; the address updates to that heading's anchor.
3. Copy the anchor and paste it to a colleague.
4. Switch to dark; the choice survives a reload without a flash of the other
   scheme.
5. Open the same document on a phone: one column, in the same order.

**Acceptance**

- Given a heading, when its anchor is opened directly, then the page loads
  scrolled to that heading.
- Given the scheme toggle, when it is pressed, then `data-theme` changes and
  nothing on the page moves.
- Given a reload, when the page renders, then the chosen scheme is applied
  before the first paint.
- Given a wide or full block, when the main region is narrower than the
  threshold, then it collapses on its own container, not on the window.
- Given a phone viewport, when the document is opened, then it is one column and
  no table forces the page to scroll sideways.

### 20. Find the runbook during an incident

- **Persona:** reader, occasional contributor
- **Situation:** three in the morning, something is down
- **Job:** find the right runbook from a half-remembered phrase, fast.
- **Milestone:** M3 — **Built**
- **Surfaces:** search
- **Journey:** `e2e/search.spec.ts`;
  `apps/server/src/routes/search.integration.test.ts` proves every acceptance
  below through `GET /api/search`, and
  `apps/web/src/features/search/*.test.tsx` proves the palette and the results
  page against a fake API

**Flow**

1. Press the search key from anywhere.
2. Type a phrase, misspelled.
3. Results appear with snippets, the current workspace's first.
4. Filter by tag, owner, or updated date if the list is long.
5. Open the runbook.

**Acceptance**

- Given a misspelled query, when it is searched, then the matching document is
  still returned.
- Given results from several workspaces, when they are listed, then the current
  workspace's come first and the rest are grouped by workspace below.
- Given a document the person cannot read, when a query matches its text, then
  neither its title nor a snippet appears.
- Given a newly published revision, when it is searched for, then it is found,
  because indexing runs from the publish event.

---

# Present to a room

### 21. Present a document to a room

- **Persona:** writer, reader
- **Situation:** a design review, in person or over a screen share
- **Job:** talk a room through a document without making slides.
- **Milestone:** M2 — **In progress** (the plan lists presentation mode as in
  progress; `present.spec.ts` exists)
- **Surfaces:** presentation mode
- **Journey:** `e2e/present.spec.ts`

**Flow**

1. Open the document and press Present. It goes full screen.
2. Each section is a step. Move with the keyboard alone.
3. Open the "go to" overlay to jump to a section by name.
4. Presenter notes from `:::notes` are visible to you and never to the room.
5. Leave; the reading view returns at the section that was on screen.

**Acceptance**

- Given a presented document, when the keyboard alone is used, then every
  section can be reached without a pointer.
- Given the go-to overlay, when a section is chosen by name, then it is the one
  on screen.
- Given a `:::notes` block, when a reader opens the document normally, then it
  is absent from the page entirely.
- Given wide and full blocks, when presenting, then they use the whole screen.
- Given the presenter leaves, then the reading view is at the section the room
  last saw.

### 22. Capture a note for later while presenting

- **Persona:** writer
- **Situation:** the room raises three things mid-presentation
- **Job:** record a follow-up against the exact place it belongs, without
  breaking stride.
- **Milestone:** M4 — **Planned** (notes are private comment threads, so they
  ship with comments)
- **Surfaces:** presentation mode, editor
- **Journey:** `e2e/present.spec.ts` (extended)

**Flow**

1. While presenting, press one key. A note opens, anchored to the current
   section — or to the focused block, or to highlighted text.
2. Type the follow-up and dismiss it. The presentation has not moved.
3. When the presentation ends, the notes appear as a checklist.
4. Next time the document is opened in the editor, the checklist is there
   again; each note jumps to its place and can become a comment or be resolved.

**Acceptance**

- Given text is highlighted, when a note is captured, then it records that
  quote, its prefix and suffix, and the revision hash.
- Given a note, when anyone else reads the document, then it is not visible: a
  note is a private thread.
- Given the presentation ends, when the checklist is shown, then each entry
  jumps to the section it was taken at.
- Given a note, when it is turned into a comment, then it keeps its anchor.

---

# Review history

### 23. Compare two revisions and restore one

- **Persona:** writer, workspace lead
- **Situation:** something changed that should not have
- **Job:** see exactly what changed between two versions and put the old one
  back, without knowing what a commit is.
- **Milestone:** M2 — **Built**
- **Surfaces:** history, compare, reading view
- **Journey:** `e2e/journey.spec.ts`

**Flow**

1. Open History on the document. Revisions are listed newest first, with author
   and time.
2. Select two and compare. Changes are shown side by side; formatting-only
   changes are labelled as such.
3. Restore the earlier one. A blocking dialog confirms.
4. The reading view shows the restored content, and history has gained an entry.

**Acceptance**

- Given two revisions, when they are compared, then the differences are shown
  and a formatting-only change is labelled, not presented as a content change.
- Given a restore, when history is reopened, then the restore is a new revision
  and the intervening one is still there.
- Given a restore, when the reading view is opened, then it shows the restored
  content.
- Given another session holding a live lock, when a restore is attempted, then
  it is refused.

---

# Share a document externally

Outbound: a person outside the organisation, reached by a link.

### 24. Share a document outside the organisation

- **Persona:** writer, workspace lead
- **Situation:** a supplier or a customer needs to read one document
- **Job:** give one person access to one document, for a bounded time, without
  creating an account for them.
- **Milestone:** M3 — **Built.** The API is proved
  (`docs/architecture/api-contract-share-links.md`): scope, view role, expiry,
  policy, the hashed token, and the audit row. The Share dialog lists a
  document's links, creates one, shows its address once, and revokes one; an
  organisation that forbids links is told so in place. A link's optional
  password waits for M7, with the comment and edit roles.
- **Surfaces:** signed-in app
- **Journey:** `e2e/share.spec.ts`, green on all four browser profiles

**Flow**

1. Press Share on the document.
2. Choose the scope — this document, or this document and everything under it.
3. Choose the role. View is the only role in the first release; comment and edit
   come in M7.
4. Choose an expiry, and optionally a password.
5. Copy the link.

**Acceptance**

- Given workspace policy forbids share links, when Share is opened, then
  creating one is not offered, with the reason reachable.
- Given a maximum role set by policy, when a link is created, then no higher
  role can be chosen.
- Given a created link, when the audit log is read, then it records the creator,
  the scope, the role, and the expiry.
- Given a link, when its token is looked for in the database, then only a hash
  is stored.

### 25. Open a share link with no account

- **Persona:** external reader
- **Situation:** the link arrived by email; they have never heard of us
- **Job:** read the document.
- **Milestone:** M3 — **Built.** `GET /api/share/:token` answers a stranger
  with the published body and nothing else, `noindex` and rate limited, and
  refuses an expired, revoked or out-of-scope request identically. `/share/
  <token>` renders it: the site's name, the document on the same reading
  surface the application uses, its contents, and the link's term — no
  session, no cookie, and one identical answer for every refusal. A subtree
  link also lists what it opens and reads each document at its own address —
  and nothing on the page preloads, because on this surface a fetch is an
  audited use of the link. A link's optional password waits for M7, with the
  comment and edit roles.
- **Surfaces:** share-link page
- **Journey:** `e2e/share.spec.ts`, green on all four browser profiles

**Flow**

1. Open the link. If it has a password, enter it.
2. The document renders, under the tenant's theme, with no application around
   it.
3. Nothing else in the organisation is reachable from the page.

**Acceptance**

- Given a valid link, when it is opened with no session, then the document
  renders without any prompt to sign in.
- Given an expired or revoked link, when it is opened, then the answer says the
  link is no longer valid and nothing about the content.
- Given a document-scoped link, when a link inside the document points outside
  that scope, then it is not followable.
- Given a share-link page, when a crawler fetches it, then it is `noindex` and
  is in no sitemap.
- Given any use, when the audit log is read, then that use is recorded.

### 26. Revoke a share link

- **Persona:** workspace lead
- **Situation:** the engagement ended, or the link went somewhere it should not
- **Job:** close the link immediately.
- **Milestone:** M3 — **Built.** `DELETE /api/share-links/:id` closes a link
  on the next request and audits who closed it; `GET
  /api/documents/:id/share-links` lists every link with its creator, scope,
  expiry and last use. The Share dialog is where both happen: the list shows
  each link's term, whether it has been used, and whether it has already been
  revoked, and Revoke asks before it closes one.
- **Surfaces:** signed-in app
- **Journey:** `e2e/share.spec.ts`, green on all four browser profiles

**Flow**

1. Open the document's share settings, which list every live link with its
   creator, scope, expiry, and last use.
2. Revoke one.

**Acceptance**

- Given a revoked link, when it is opened, then it no longer works, on the next
  request and not after a cache expiry.
- Given revocation, when the audit log is read, then it records who revoked it
  and when.
- Given a revoked link on a document that is also public, when the public
  address is opened, then the document is still readable — revoking a link
  closes that channel only (ADR-012 amendment).

---

# Publish a collection publicly

### 27. Publish a collection to the public web

- **Persona:** workspace lead, unit administrator
- **Situation:** the team ships a product and documents it in the open
- **Job:** turn a collection into a public documentation site.
- **Milestone:** M3 — **Planned** (ADR-023)
- **Surfaces:** signed-in app, public site
- **Journey:** `e2e/publish-public.spec.ts` (planned)

**Flow**

1. Open the collection's publish settings.
2. Set the slug or path, the site name and logo, and the top navigation links.
3. Publish. This creates a viewer grant to the public principal.
4. Open the public address in a private window to check it.

**Acceptance**

- Given a published collection, when its address is opened anonymously, then
  the index document renders as server-side HTML.
- Given publishing, when a document in the collection has never been published,
  then it does not appear on the site.
- Given the public grant, when a signed-in editor's access is resolved, then it
  is unchanged — a public grant can only widen.
- Given organisation policy forbids publishing, when the settings are opened,
  then publishing is not offered.

### 28. Read the public site with no account

- **Persona:** external reader
- **Situation:** a customer looking for how something works
- **Job:** find and read the documentation.
- **Milestone:** M3 — **Planned**
- **Surfaces:** public site
- **Journey:** `e2e/publish-public.spec.ts` (planned)

**Flow**

1. Arrive at the site's home: the published collection's index document, under
   the tenant's header.
2. Navigate by the collection's tree.
3. Search within the site.
4. Read, in light or dark, on a laptop or a phone.

**Acceptance**

- Given no session, when any public page is requested, then the content is in
  the first response, with no redirect to sign in.
- Given public search, when a query matches a non-public document, then nothing
  about it is returned.
- Given the public site, when the page is inspected, then there is no workspace
  switcher, sidebar of other workspaces, comment panel, or account menu.
- Given a signed-in member, when they open a public address, then they get the
  public page with one "Open in the app" affordance.

### 29. Index and unfurl the public site

- **Persona:** crawler or indexer
- **Situation:** a search engine, an LLM crawler, or a chat client's unfurler
- **Job:** fetch, understand, and link to public documentation reliably.
- **Milestone:** M3 — **Planned**
- **Surfaces:** public site
- **Journey:** `e2e/crawler.spec.ts` (planned)

**Flow**

1. Fetch `/robots.txt` and the sitemap.
2. Fetch each listed page with no cookies and no JavaScript.
3. Read the title, description, canonical link, and Open Graph tags.
4. Return later; unchanged pages are cheap.

**Acceptance**

- Given JavaScript disabled, when a public page is fetched, then the full
  document text is present in the HTML.
- Given a page reachable by more than one address, when it is fetched, then a
  single canonical link names the authoritative one.
- Given the sitemap, when it is fetched after a publish, then the new revision's
  page is listed and the stale entry is not.
- Given a document that has a draft, when the sitemap and every public page are
  examined, then no draft content appears anywhere.
- Given a share-link address, when robots rules are read, then it is excluded.
- Given a chat client's unfurl request, when it fetches a public page, then the
  title, description, and image come back without a session.

### 30. Take one document off the public web

- **Persona:** workspace lead
- **Situation:** one page in a public collection should not be public
- **Job:** unpublish exactly that page, without hiding it from the people who
  maintain it.
- **Milestone:** M3 — **Planned** (the resolution rule is built; ADR-012
  amendment)
- **Surfaces:** signed-in app, public site
- **Journey:** `e2e/publish-public.spec.ts` (planned)

**Flow**

1. Open the document's access settings inside a public collection.
2. Deny the public principal at this document.
3. Save.

**Acceptance**

- Given a deny to public at one document in a public collection, when that
  document's public address is opened anonymously, then it is not available.
- Given the same deny, when a member who holds a user or group grant opens it
  signed in, then they still see it.
- Given the deny, when the sitemap is regenerated, then that page is gone from
  it.
- Given a deny attempted above document scope, when it is saved, then it is
  refused.

---

# Comment and resolve

### 31. Comment inline and resolve

- **Persona:** reader, writer
- **Situation:** reviewing a colleague's design document
- **Job:** ask a question about one paragraph, and close it when it is answered.
- **Milestone:** M4 — **Planned** (a data model and a panel primitive exist)
- **Surfaces:** reading view, editor
- **Journey:** `e2e/comments.spec.ts` (planned)

**Flow**

1. Select a sentence and add a comment. Or comment on the page, with no anchor
   at all.
2. The author is notified, in the app and by email.
3. They reply, or fix the text.
4. Someone resolves the thread. It leaves the margin and stays in the record.

**Acceptance**

- Given an anchored comment, when the document is exported as Markdown, then
  nothing about the comment is in the file.
- Given a mention, when the thread is saved, then the mentioned person is
  notified through the outbox.
- Given a resolved thread, when the document is read, then the thread is not in
  the way but is still retrievable.
- Given a comment, when it is stored, then it records the revision hash it was
  made against.

### 32. Keep comments attached after an outside edit

- **Persona:** writer
- **Situation:** a revision arrived from a synced repository, or from another
  editor
- **Job:** find the comments still against the right text, and deal honestly
  with the ones that cannot be.
- **Milestone:** M4 — **Planned** (ADR-022, pending research R7)
- **Surfaces:** reading view, editor
- **Journey:** `e2e/comments.spec.ts` (planned)

**Flow**

1. A new revision lands.
2. Re-anchoring matches each thread's stored quote against the new content.
3. Threads that moved are shown against their new position.
4. Threads that cannot be placed are shown as orphaned, with their original
   quote, and can be re-attached by hand.

**Acceptance**

- Given a paragraph that moved but did not change, when a revision lands, then
  its thread is still against that paragraph.
- Given a paragraph that was deleted, when a revision lands, then its thread is
  marked orphaned with its original quote, and is not lost.
- Given an orphaned thread, when a person re-attaches it, then the new selector
  is stored against the current revision.
- Given re-anchoring, when the Markdown is inspected, then it is unchanged: no
  block ids and no comment markers.

---

# Sync with a repository

### 33. Connect a workspace to a repository

- **Persona:** workspace lead
- **Situation:** the team wants documentation in the product *and* in Git
- **Job:** keep a workspace and a repository in step, in both directions,
  without anyone running a command.
- **Milestone:** M4 — **Planned**
- **Surfaces:** signed-in app, workspace settings
- **Journey:** `e2e/sync.spec.ts` (planned)

**Flow**

1. In workspace settings, connect a repository: remote, branch, path prefix,
   credentials.
2. The first sync imports what is there. Files without an id get one.
3. From now on, publishing pushes in the background. There is no sync button.
4. An external commit arrives by webhook or poll, and appears as a revision by
   "external", showing the commit's author.

**Acceptance**

- Given a connected repository, when a document is published, then the change
  appears in the repository without anyone pressing anything.
- Given an external commit, when it is pulled, then it appears in history as a
  revision by "external" with the commit author shown.
- Given a document edited on both sides, when the merge fails, then the document
  is marked as needing attention for its editors, with a side-by-side view.
- Given a sync failure, when notifications are sent, then workspace
  administrators are told and writers are not.
- Given a round trip with no edits, when the Markdown is compared, then it is
  byte-identical: serialisation is deterministic.

### 34. Attach a repository as a read-only source

- **Persona:** workspace lead
- **Situation:** a team wants their `docs/` folder indexed here but written
  there, in the same pull request as the code
- **Job:** get one searchable index of every application's documentation
  without moving anybody's files.
- **Milestone:** **Idea, not scheduled.** See
  [`docs/ideas/external-git-sources.md`](../ideas/external-git-sources.md)
- **Surfaces:** signed-in app
- **Journey:** `e2e/external-sources.spec.ts` (would be)

**Flow**

1. Attach a repository to a collection as an external source: remote, branch,
   path prefix, and the URL template for editing at head.
2. Its documents appear, render, search, link, and take comments like any
   others.
3. The edit affordance takes the reader to the file in the hosting service.
4. When the remote moves ahead, a promise toast says the mirror is updating and
   resolves with a Reload action.

**Acceptance**

- Given an external source, when any of its documents is opened, then editing
  here is not offered, and editing there is.
- Given the remote is ahead, when a document is opened, then the current mirror
  renders immediately and the update happens behind it.
- Given a sync completes, when the reader is mid-selection, then the page does
  not reload underneath them.
- Given a webhook delivery that is duplicated or missed, when the source is next
  reconciled, then the result is the same either way.

---

# Theme and layout

Who decides what comes from the table in the ADR-028 amendment: identity
belongs to the organisation, layout to the workspace, and scheme, motion,
contrast, and size to the person.

### 35. Give the organisation its identity

- **Persona:** instance administrator
- **Situation:** first run, or a rebrand
- **Job:** make the product look like this organisation, in a few minutes,
  without producing something ugly.
- **Milestone:** M3 — **Planned** (the token system and the three built-in
  themes exist; the onboarding flow does not)
- **Surfaces:** signed-in app, settings
- **Journey:** `e2e/theme.spec.ts` (planned)

**Flow**

1. Upload a logo and, optionally, enter brand colours. Candidate accent and
   tone are extracted.
2. Answer three questions: what the workspace mostly holds, how the team wants
   it to feel, how dense they like their tools.
3. A built-in theme is suggested — Instrument, Press, or Atelier — previewed on
   a real document in light and dark, with the logo and accent applied.
4. Adjust the levers: accent, tone, reading face, radius, density. Contrast is
   re-checked on every change.
5. Save. The theme is a fork of the built-in, re-openable later.

**Acceptance**

- Given an accent too light for text, when it is chosen, then the exact value is
  kept for marks and surfaces, a contrast-safe variant is derived for links and
  controls, and the flow says so.
- Given any saved theme, when text contrast is measured, then it meets AA, or an
  instance administrator has deliberately made that advisory.
- Given a theme rule that warns, when the tenant keeps the value anyway, then it
  is saved: the theme doctor advises, it does not block.
- Given a saved theme, when a document is read in the app, on the public site,
  in presentation mode, and in an HTML export, then it looks the same in all
  four.
- Given a workspace, when it tries to change identity, then it cannot, unless
  the organisation allows it.

### 36. Choose a workspace's layout

- **Persona:** workspace lead
- **Situation:** a product workspace and an engineering workspace want different
  arrangements of the same identity
- **Job:** choose how this workspace is arranged, without changing how the
  organisation looks.
- **Milestone:** M3 — **Planned** (ADR-028 amendment; until then the attributes
  come from the theme, which is indistinguishable while every workspace uses
  the default)
- **Surfaces:** signed-in app, workspace settings
- **Journey:** `e2e/theme.spec.ts` (planned)

**Flow**

1. Open workspace settings, layout.
2. Choose from the bounded set: navigation as a tree or as collection tabs;
   comments in a panel or as sidenotes; history as a timeline or a menu; header
   as a status readout or a breadcrumb bar; sections divided by rules,
   hairlines, or cards.
3. Save. Only this workspace changes.

**Acceptance**

- Given a layout change, when another workspace is opened, then it is unchanged.
- Given a layout change, when the type, colour seeds, radius, and density are
  measured, then none of them moved.
- Given the organisation has locked layout, when workspace settings are opened,
  then the choice is not offered, with the reason reachable.
- Given any layout, when the sidebar is examined, then it still shows the
  current workspace only.

### 37. Set personal reading preferences

- **Persona:** reader, writer
- **Situation:** anybody, at any time
- **Job:** read the way they need to, everywhere, permanently.
- **Milestone:** M2 for scheme; the rest with personal preferences in M3 —
  **Partly built**
- **Surfaces:** every signed-in surface
- **Journey:** `e2e/design.spec.ts` (scheme today), extended later

**Flow**

1. Choose light, dark, or system.
2. Choose a text size, reduced motion, and high contrast.
3. Move between workspaces. The choices follow.

**Acceptance**

- Given any tenant setting, when a person's colour scheme, reduced motion, or
  high contrast preference is applied, then no tenant setting can remove it.
- Given a larger reading size, when the editor is opened, then the editor is not
  enlarged with it.
- Given a scheme choice, when the page reloads, then there is no flash of the
  other scheme.
- Given the tone preference, when the organisation has not allowed members to
  choose it, then it is not offered.

---

# Administer

### 38. Sign in with the organisation's provider

- **Persona:** any member
- **Situation:** the organisation uses Microsoft Entra ID, Google Workspace,
  Okta, Auth0, or Cognito
- **Job:** sign in with the account they already have.
- **Milestone:** M3 — **Built** for OIDC on 13 September (ADR-011; SAML and
  SCIM are M8), proved end to end by an in-process OpenID Connect provider in
  `apps/server/src/routes/auth-oidc.integration.test.ts`, and now also by a
  real browser driving that same provider — run as its own process,
  `apps/server/src/scripts/fake-oidc-server-cli.ts` — in `e2e/sso.spec.ts`.
  The client secret is a name resolved from the settings store's secrets at
  the moment of use, falling back to the environment for one release
  (ADR-034); providers are otherwise still configured per instance from the
  environment. The administration screen, "require SSO for this domain",
  home-realm discovery by email domain, group mapping, and back-channel
  logout are still to come.
- **Surfaces:** signed-in app
- **Journey:** `e2e/sso.spec.ts`

**Flow**

1. An instance administrator configures the provider from a preset: issuer,
   client id and secret, tenant or hosted domain, allowed email domains,
   linking and provisioning policy, group mapping.
2. A member presses "Continue with Microsoft", or enters an email whose verified
   domain routes them to their provider.
3. They return signed in; their groups map to groups here.

**Acceptance**

- Given a configured provider, when a member signs in, then the account is keyed
  by issuer and subject, not by email.
- Given SSO required for a domain, when a member of that domain tries a password
  or a magic link, then it is refused, while passkeys and break-glass instance
  administrator access still work.
- Given a provider that asserts an unverified email, when sign-in completes,
  then the email is not trusted for linking.
- Given an account here that has never verified that address, when somebody
  signs in through the provider with it, then nothing is linked and the
  refusal is the same one every other failure gives — the account's owner
  verifies their email first, and the link is then safe to make.
- Given a sign-out at the provider with back-channel logout, when the next
  request arrives here, then the session is already revoked.

### 39. Manage sessions and sign out everywhere

- **Persona:** any member
- **Situation:** a lost laptop, or a shared machine
- **Job:** see every session and end them.
- **Milestone:** M1 — **Built** in the API; the settings screen is later
- **Surfaces:** account settings
- **Journey:** `e2e/administer.spec.ts` (planned)

**Flow**

1. Open account settings, sessions.
2. See each session with its device, address, and last use.
3. Revoke one, or sign out everywhere.

**Acceptance**

- Given a revoked session, when its cookie is presented, then the request is
  refused, because sessions live server-side.
- Given a password or passkey change, when it completes, then the session is
  rotated.
- Given thirty days since sign-in, or seven days idle, when a request arrives,
  then the session has expired server-side regardless of the cookie.

### 40. Review the audit log

- **Persona:** instance administrator
- **Situation:** a question about who did what
- **Job:** answer it from the record.
- **Milestone:** events from M1 — **Built**; the audit log interface is M8 —
  **Planned**
- **Surfaces:** signed-in app, settings
- **Journey:** `e2e/administer.spec.ts` (planned)

**Flow**

1. Open the audit log.
2. Filter by person, by kind of event, or by date.
3. Read the entries: authentication outcomes, permission changes, share-link
   creation and use, exports, administrative actions.

**Acceptance**

- Given any grant change, when the log is read, then the change is there with
  who, what, and which scope.
- Given a share link, when it is used, then a row records the use.
- Given any audit row, when it is read, then it contains no password, token,
  session id, or secret.
- Given an export, when it completes, then it is recorded.

### 41. Export a workspace as Markdown

- **Persona:** workspace lead
- **Situation:** an audit, a migration, or simply proving nothing is trapped
- **Job:** get everything out, in a form that is useful without this product.
- **Milestone:** M4 — **Planned**
- **Surfaces:** signed-in app, exports
- **Journey:** `e2e/export.spec.ts` (planned)

**Flow**

1. Choose export on a workspace or a collection.
2. Choose Markdown with assets. A promise toast tracks it and resolves with a
   download.
3. Open the ZIP: Markdown files with front matter, and the assets beside them.

**Acceptance**

- Given an export, when a file is re-imported, then it produces the same
  document: the round trip is lossless for everything the pipeline preserves.
- Given an export, when the Markdown is read outside this product, then
  directives degrade to readable content.
- Given comments on a document, when it is exported as Markdown, then no comment
  is in the file; a separate JSON export carries them.
- Given a live block, when it is exported, then the static rendering is included
  with its "as of" stamp, and a viewer-scoped block is omitted with a note.

### 42. Publish from CI

- **Persona:** integrator
- **Situation:** generated documentation — an API reference, a schema — that a
  pipeline produces
- **Job:** publish it on every build, without a person.
- **Milestone:** M8 — **Planned** (the public API and personal tokens). Until
  then Git sync (use case 33) is the supported path.
- **Surfaces:** API
- **Journey:** `e2e/api.spec.ts` (planned)

**Flow**

1. An administrator issues a personal API token scoped to a principal.
2. CI calls the API to create or update the document and publish it.
3. A failure fails the build with a message that says what to fix.

**Acceptance**

- Given a token, when it is used, then it can do exactly what its principal can
  do, and no more.
- Given a publish through the API, when the document is read in the app, then it
  is indistinguishable from one published by a person, apart from its author.
- Given a new API version, when an old client calls the previous one, then it
  still works for the published support period.
- Given a non-additive change to the API, when CI runs, then the OpenAPI diff
  fails the build.
