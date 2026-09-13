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

The person, not the workspace, is the subject. Sections, in this order, each
omitted when empty rather than shown blank:

1. **Continue.** Documents the person holds a lock on or has unpublished
   draft changes in. One click back into the editor. (M2: from the lock and
   draft state the API already has.)
2. **Your workspaces.** Every workspace the person can see, grouped by unit,
   with the last-updated time. If there is exactly one, home skips itself
   and opens it. (M2: the workspace list route.)
3. **Recently updated.** Published changes across the person's workspaces,
   newest first, permission-filtered. (M2: from the document list; a proper
   activity feed comes with comments in M4.)
4. **Recently viewed by you.** Kept per person. (M2: client-side, as a
   personal preference; synced server-side when preferences are stored.)
5. **Pinned.** Person-owned, always at hand. (With personal preferences.)
6. **What others are reading.** Popular in your workspaces. **Not before a
   decision on privacy:** only ever aggregate counts, never who; off by
   default; an organisation setting. Open question for M4.

Admins additionally see a short **set-up** card until it is done: create the
first unit, workspace, and collection; invite people; choose a theme.

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

The signed-in home with Continue, Your workspaces, Recently updated, and the
admin set-up card; the workspace home with its home document and the
Collections, Recently updated, and In progress sections. Recently viewed and
Pinned come with personal preferences; the public site home comes with M3.
