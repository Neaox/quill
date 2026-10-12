# Home: what a person sees first

Three different "first pages", for three different situations. They share
the renderer and the design system and nothing else, because they answer
different questions.

| Situation | Question it answers | Shell |
| --- | --- | --- |
| **Signed-in home** (`/`) | "Where was I, and what changed since?" | The full app shell |
| **Workspace home** (`/w/<workspace>`) | "What is in this workspace, and where do I start?" | The full app shell, sidebar showing this workspace |
| **Public site home** (a published collection's own address) | "What is this documentation, and where do I begin?" | No app shell: the public site's own header and navigation, tenant-configured (ADR-028 amendment) |

A signed-in member who opens a public address gets the public page, with one
"Open in the app" affordance, so links shared outside the organisation look
the same to everyone.

## Signed-in home

The person, not the workspace, is the subject. It is a calm dashboard: one
accent, and nothing shown blank. It sits in the application column `AppPage`
gives a full-width surface (centred, capped so a 2560-pixel window still reads
as one composition, a 16px gutter on a phone). On a phone it is one column in
the order below; from `lg` it is two columns, the long lists (the checklist,
Recently updated) on the left and the short ones (Continue writing,
Workspaces, Organisation) on the right, so a wide window is used and neither
column runs on while the other stands empty. In
order:

1. **Who and when.** Today's date in the muted ink, then a greeting by the
   hour and the person's name. The organisation's name is already in the bar.
2. **Search or jump to.** A full-width field that opens the command palette:
   documents, workspaces, and (for an administrator) every setting, so the
   page's first action reaches everything.
3. **Set up your organisation** (administrators only). A checklist rather
   than a card: name the organisation and choose its theme, create the first
   workspace (a unit, then a workspace in it, through the same dialogs the
   organisation page uses), publish the first document. Each step is answered
   from what the API already says — a name other than the product's, a
   workspace, a published document — with its action beside it and a count of
   how many are done. It leaves once every step is done, and can be hidden
   sooner; hiding is remembered per browser.
4. **Continue writing.** Drafts that have never been published, newest first,
   five at most, with the total beside the heading. Omitted when there are
   none. (The list DTO cannot say whether a published document has a newer
   draft, or who holds a lock; those are each document's envelope.)
5. **Workspaces.** Every workspace the person can see, as cards: its name, its
   unit's path, how many documents and drafts it holds, and when anything in
   it last changed. If there is exactly one, home skips itself and opens it.
6. **Recently updated.** Published changes across the person's workspaces,
   newest first, eight at most, with the workspace and a relative date ("3
   days ago", the exact date on hover and in `datetime`). Before anything is
   published it says so in a sentence instead.
7. **Organisation** (administrators only). Every settings screen as a list of
   links in one card: the same destinations as the person menu's Organisation
   group and the palette (`chrome.md`, "Reaching settings"), so the way in
   stays on the page after the checklist has gone.
8. **Recently viewed by you** and **Pinned** come with personal preferences;
   **What others are reading** waits on a privacy decision (aggregate counts
   only, never who; off by default; an organisation setting; M4).

A person with no workspace is told whom to ask; an administrator with none is
pointed at Units and workspaces. Everything above is counted from the same
per-workspace document lists the workspace pages read, fetched in parallel,
so opening a workspace afterwards costs nothing.

## Workspace home

The workspace is the subject. It is a **document**: every workspace has a
home document (created with the workspace, editable by anyone with `edit`)
that renders as its front page, so a team can write the introduction, the
conventions, and the links they want people to see first, using the same
editor as everything else. Beneath the document, fixed sections the
workspace cannot write by hand but can reorder or hide:

- **Collections** with document counts and the newest change in each.
- **Recently updated** in this workspace.
- **In progress**: drafts and locked documents, for writers.
- **Needs attention** (later): review due, broken links, orphans (M6).

When live blocks arrive (ADR-032, M5), these sections become live blocks the
home document can place itself, and the fixed layout goes away without a
migration, because the data they show is the same.

## Public site home

Owned by publishing (M3, ADR-023). The site's home is the published
collection's index document, rendered without the app shell, under the
tenant's public header: site name and logo, the configurable top links, and
search scoped to the site. Navigation is the collection's tree. Nothing from
the signed-in world (drafts, locks, other workspaces) exists here.

## User stories the pages must satisfy

- A **reader** opening the app in the morning wants to see what changed in
  the workspaces they follow, and to get back to the document they were
  reading yesterday, in two clicks or fewer.
- A **writer** wants their unfinished work in front of them before anything
  else, and a one-click way back into it.
- An **admin** setting up wants to be walked through the first workspace,
  collection, and document without reading a guide, and then never see that
  card again.
- **Anyone outside the organisation** following a shared link wants the
  documentation, not an application.

## What M2 ships

The signed-in home with Continue writing, Workspaces, Recently updated, and the
administrator's set-up checklist; the workspace home with its home document and the
Collections, Recently updated, and In progress sections. Recently viewed and
Pinned come with personal preferences; the public site home comes with M3.
