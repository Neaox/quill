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
accent, no walls of text, nothing shown blank. It sits in the application
column `AppPage` gives a full-width surface. In order:

1. **Who and when.** Today's date in the muted ink, then a greeting by the
   hour and the person's name. The organisation's name is already in the bar.
2. **Search or jump to.** A full-width field that opens the command palette.
3. **Set up your organisation** (administrators only). A checklist until the
   instance is set up, as before.
4. **Needs your attention.** What is waiting on the person, as sentences that
   say what is asked: a review requested of them or of a group they are in
   ("Ada asked you to review Release notes"), changes asked for on their
   draft, an approval of theirs (ADR-052). The only part of the page with an
   accent edge, and omitted when empty. It is first because it is the one
   thing somebody else is waiting on.
5. **Continue writing.** The one place on the page that is a card: documents
   **the person created** that have never been published, newest first, five at
   most, with "5 of 23" when there are more. Omitted when there are none.
6. **Jump back in.** The documents they opened most recently, as small links,
   from their own viewing history (ADR-053). Omitted until they have opened
   something; clearable from Preferences.
7. **Recently updated** (left from `lg`). Published changes by other people,
   newest first, ten at most, **under the day they happened** ("Today",
   "Yesterday", "Friday", "20 September"). For somebody with a history it
   covers **their places**, the workspaces they have opened or written in
   lately, with a quiet switch to **Everywhere**; with no history it covers
   everywhere and offers no switch. The day is the heading, so a row says only
   the document, its workspace and the time of day. When their places are quiet
   it says so and offers Everywhere.
8. **Workspaces** (right from `lg`, first on a phone). Every workspace the
   person can see, as rows rather than boxes: a monogram, the name, drafts,
   how many documents, and when anything last changed (dropped when the column
   is too narrow for it, by container width). The order is **theirs first**:
   by how much they have been in it lately (opens and documents created), then
   by recent change; with no history, the organisation's order. It scales by
   what is there:
   - **Twelve or fewer:** one flat list, each row naming its unit when they
     differ. Three workspaces under three headings is furniture.
   - **More:** the eight most relevant to them, and "Show all N", which opens
     the whole list grouped under each unit's path. From sixty entries the
     grouped list is a window onto its rows (`VirtualRows`), in a region of
     bounded height, so a few thousand workspaces cost what a screenful does.
   - **From eight:** a filter, which searches all of them by name or unit.
   If there is exactly one, home skips itself and opens it.
9. **Organisation** (administrators only). Every settings screen as a quiet
   row of links: the same destinations as the person menu's Organisation group
   and the palette (`chrome.md`, "Reaching settings").
10. **Pinned** comes with personal preferences;
   **What others are reading** waits on a privacy decision (aggregate counts
   only, never who; off by default; an organisation setting; M4).

A person with no workspace is told whom to ask; an administrator with none is
pointed at the set-up checklist, and at Units and workspaces once that is
hidden (never both at once).

Everything above comes from **one bounded request**, `GET /api/home`: a row of
figures per workspace, the newest five drafts (with how many there are in
all), and the newest ten published changes, counted on the server through the
same visibility pass every other list uses. The page used to fetch every
workspace's whole document list and count in the browser, which is a request
per workspace and a payload per document. While it loads the page shows bars
in the shape of what is coming; when it fails the workspaces still list, and
the feed offers to try again.

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
