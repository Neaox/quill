# The reading chrome

The frame around a document while it is being read in the signed-in app: the
top bar, the navigation sidebar, the complementary column (contents,
revisions, signals), and the space around the body. The body's own typography
is `packages/design-css/src/prose.css` and is not covered here.

The aim is a frame that is calm enough to disappear while reading and clear
enough to find your way in at a glance. The benchmark it was tuned against is a
documentation site a reader called polished because the text "pops" without the
page feeling like a wall of text: one face, a few sizes and weights, three inks,
and an accent used only to say "you are here".

## Rules

1. **One face in the chrome.** Every label, link, control and fact in the
   frame is set in the interface face (`--font-sans`). Nothing in the chrome is
   monospace or uppercase-tracked. The only small capitals on the reading page
   are the eyebrow above the title, which belongs to the document.
2. **Three inks.** `text-foreground` for headings, the current item and
   anything the reader acts on; `text-foreground-soft` for what is scanned but
   not stopped on (the sidebar's documents, a control's label, a revision's
   version); `text-muted` for facts (dates, counts, "on this page" entries,
   signals). `foreground-soft` is derived from the other two in `tokens.css`,
   so every identity has it and it always sits between two inks the theme
   doctor has already passed.
3. **Section labels are small headings, not metadata.** A collection's name,
   "On this page", "Revisions", "Signals": `.section-label`, the chrome's text
   size in ink at semibold. A count beside one is `.section-count`, in the
   quietest ink.
4. **Where am I is a soft selection.** The current document in the tree and
   the current rail section sit on `bg-accent-subtle` with a rounded corner, in
   full ink and one weight heavier, driven by `aria-current`. The heading being
   read in "On this page" takes full ink and lays the accent over its stretch
   of the list's hairline. Never colour alone: weight and position say it too.
5. **Text sits on the page.** The sidebar and the complementary column have no
   panel colour and no rule against the document; only where they stack on a
   narrow screen does a hairline separate them. Only things that are objects
   (a figure, a table, a callout, a control's well) are raised.
6. **The bar is part of the page.** The sticky header is the page colour at
   88 percent over a backdrop blur, with a hairline below. Its controls are
   quiet: Present and Share are ghost buttons, search is a well (`bg-surface`)
   with an edge only under the pointer, and the person menu is an avatar and
   a name in the soft ink that takes the well's colour when it is open. The
   same bar, at the same height, is on every signed-in page: the workspace
   shell, the home page and the settings screens.
7. **The accent appears once per region.** In the bar it is the soft Edit
   button (`variant="soft"`: the accent tint with ink text, which passes AA
   under any identity where accent-coloured text on the tint would not) and
   the dot beside "Published". In the sidebar it is the current document. In
   the column it is the current heading and the current revision tick.
8. **What gives way, in order.** As the bar narrows: the revision date (below
   `2xl`; the revisions column carries
   it), the state (below `xl`), the words on Search, Present and Share (below
   `lg`, leaving their icons and accessible names), the path's ancestors (below
   `lg`), and on a phone the trail itself and the person's name beside the
   avatar, leaving the bar to the controls with the document's title the
   first thing beneath it.
9. **The eyebrow is automatic.** A published body that opens with its own
   title and has no eyebrow of its own gets the name of its collection as one,
   added by `DocumentBody` as the same paragraph an author would write, so the
   prose stylesheet's eyebrow rule styles both identically. It is text, not a
   heading, and never enters the outline.

## Reaching settings

Three kinds of setting, owned by three different people, and each has one
home (quill-plan.md's product decisions: organisation, workspace and person
own distinct settings):

| Whose | What | Where it lives | How a person gets there |
| --- | --- | --- | --- |
| **The person's** | Colour scheme: System, Light or Dark (ADR-028, layer 3) | The person menu's **Appearance** group, applied at once and remembered in the browser | The avatar and name at the end of every signed-in bar |
| **The workspace's** | Its layout, within the organisation's lock | `/w/<workspace>/settings` | The workspace's own overflow menu |
| **The organisation's** | Organisation settings, Theme, Labels and emoji, Layout, Secrets and sign-in, and the unit and workspace tree | `/admin/settings/*` and `/admin/organisation`, instance administrators only | The person menu's **Organisation** group; the command palette; the home page's **Organisation** section and set-up checklist |

The rules behind that:

1. **The person menu is the one place for what belongs to the person.** It is
   a real menu button (`MenuButton` in `@quill/ui`): Enter, Space or the down
   arrow opens it onto its first item, the arrows and type-ahead move through
   it, Escape closes it and gives focus back. Its accessible name is "Account
   menu for" and the person's name, so it contains the words it shows. It
   opens with the person's name and email, then Appearance, then (for an
   administrator) Organisation, then Sign out, last, as everywhere else.
2. **The colour scheme is not a bar control.** It is set once and left alone,
   and a phone's bar has no room for three segments; in the menu it is
   reachable at every width, and choosing one keeps the menu open so the
   change can be seen and undone. The signed-out pages and the design
   showcase, which have no person menu, keep the segmented switch. Both read
   one list of schemes (`features/theme/colour-schemes.ts`).
3. **Administration is offered only to whoever can use it.** The
   Organisation group, the palette's Organisation commands, the home page's
   Organisation section and the set-up checklist are all decided by
   `me.isInstanceAdmin`, the same fact the `/admin` routes gate on, so
   nobody is offered a page that would answer not-found. Every surface reads
   one list of destinations (`features/admin/organisation-destinations.ts`),
   held by a test to the settings frame's own navigation, so a new settings
   screen cannot be reachable from one and missing from another.
4. **Everything in the menu is also in the palette.** Ctrl+K or Cmd+K lists
   Home, Sign out and (for an administrator) the organisation's settings
   before anything is typed, and matches them by name or by keyword as soon
   as something is ("sso" finds Secrets and sign-in, "emoji" finds Labels
   and emoji, "log out" finds Sign out); workspaces join when they are asked for by name. Places are listed
   above document results, because they answer at once.

## Why the chrome stopped using `.meta`

ADR-019 section 7 sets metadata in the mono face, small and uppercase, and on
the reading page that habit had spread to every label in the frame: the theme
switch, the collection headings, "Revisions", "On this page", "Signals", the
revision readouts and the path. Each instance was defensible; together they
made the frame read as debug output and competed with the document for
attention. The amendment to ADR-019 narrows section 7 to tabular metadata in
content surfaces (data tables, code block captions, the merge view) and takes
the chrome out of it. Tabular figures (`tabular-nums`) keep columns of dates
and versions aligned without a monospace face.

Themes are unaffected in kind: every colour, face and radius above is a token,
so an identity changes how the chrome looks without changing these rules.
