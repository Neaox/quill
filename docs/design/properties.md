# Document properties

A document's properties are the facts it states about itself in its front
matter (ADR-005): its lifecycle, its owners, its type, its tags, how often it is
reviewed and when it last was, and the answers to its template's questions.
This page says what those facts are for, who needs them, and how each surface
shows them. ADR-059 records the two decisions in here that are architectural:
what a public reader sees, and how tags relate to labels.

## What properties are for

| Purpose | The question it answers | Who asks | How often |
| --- | --- | --- | --- |
| **Trust and currency** | Is this current? Who do I ask? Has anyone checked it? Should I still use it? | Every reader, before relying on the page. | Every visit, in a glance. |
| **Organisation and findability** | What kind of document is it? What else is like it? | Readers browsing; search (`tag:`, `owner:`, `status:`); review-due lists. | When looking for something. |
| **Workflow** | Is it in review, verified or deprecated? When is it due for review? Did I answer the template's questions? | Authors and owners. | While writing, and at review time. |

Trust is the reason the facts are on the page at all. A reader who cannot tell
whether a runbook is current, or whom to ask about it, cannot rely on it; the
documentation tools people stop trusting are the ones where every page looks
equally authoritative. So the trust signals are the ones shown without asking,
and they are worded as a reader would say them: "Reviewed 3 months ago",
"Review overdue", "Alex Chen", not `review.lastReviewed: 2026-07-12`.

## Seeing: the byline

Every surface that shows a document shows one **byline**: a single quiet line
under the title, between hairlines, as the reading canvas draws it
(`canvas/Main.dc.html`). Its parts, in reading order:

1. **Owners**, as people: a small initials avatar and the person's name. An
   owner who is not a person in Quill (a team mailbox, a team name) is shown as
   written. Readers never see an owner's email address when the owner is a
   person Quill knows.
2. **Lifecycle**, when the author or an owner has set one, as a lozenge whose
   mark differs in shape as well as colour (a dot for In review, a tick for
   Verified, a bar for Deprecated) *and* its word. A verification says who and
   when: "Verified by Ada Lovelace · 2 weeks ago". When the review it promised
   falls overdue it says **"Verification lapsed"** instead, with a warning
   mark, beside "Review overdue"; nothing in the file changes. Nothing is shown
   when no lifecycle is set. See *Publication, lifecycle and freshness* below.
3. **Type**, as a word ("Runbook").
4. **Review**: "Reviewed 3 months ago" as a `time` whose `datetime` and
   tooltip are the exact date; then "next due in 2 months"; in the fortnight
   before, **"Review due in 5 days"**, a step louder; after it, **"Review
   overdue"** with a warning glyph and the word, never colour alone. This is
   freshness: "needs update" is always computed, never a value someone sets.
5. **Tags**, last, as small links to the workspace's search for that tag
   (`tag:runbook`), so a tag is a way to find the rest of its kind.

Nothing that is unset takes space, and a document with no properties has no
byline at all. The byline is a `dl`: each fact is a term (visually hidden where
the value says what it is) and its value, so a screen reader hears "Status,
Draft" and "Owners, list, 2 items".

**Where.** Under the title, because the trust signals belong next to the thing
they qualify and are what a reader looks for before reading on (Confluence's
byline, Notion's property rows and the canvas all put them there). In the
editor the properties sit above the title for now (see *Deferred*).

**Which surface shows what.** Signed-in readers see everything above.
Share-link and public readers are outsiders: they see the lifecycle (a
verification with its date but never who made it, and only while it stands),
when it was last reviewed, and tags as plain words (or, on the public site,
links to the site's own search). They never see owners, verifiers or review
due dates: an owner is a person, and the organisation's review cadence is
internal process (ADR-059).

**Deprecated pages say so.** Under the byline of a deprecated page, on every
reading surface, a notice: "This page is deprecated. Use *Replacement*
instead." The replacement is linked only where the reader may open it; when
they may not, or none is set, it reads "It is kept for reference and may be
out of date." Deprecated pages rank lower in search.

## Publication, lifecycle and freshness

Three questions a reader asks about a page, answered by three different
parties (ADR-005, amendment of 17 October 2026):

| Question | Values | Set by | Shown as |
| --- | --- | --- | --- |
| Publication | Never published · Published · Published, with unpublished changes | The system, always | The header's state pill |
| Lifecycle (optional) | In review · Verified · Deprecated | The author or an owner | The byline's lozenge; nothing when unset |
| Freshness | Review due · Review overdue | Computed from the review date | The byline, beside "Reviewed 3 months ago" |

A `status` from an earlier release (`draft`, `published`, `archived`) is kept
in the file exactly as written, shown read-only under "All properties", and
never shown to a reader as a lifecycle.

**Relative and absolute time.** The application shows relative time with the
absolute date in the tooltip and `datetime`. The public site and the share page
show the absolute date only, because a page served from a cache has no "now"
to be relative to (the rule the public footer already follows).

## Interacting: editing in place

In the editor the byline becomes the editing surface. Each value is a button;
pressing it opens that property's editor in a popover anchored to it, and
Escape or a press elsewhere closes it and returns focus to the value. There is
no wall of empty inputs: known properties that are unset are offered from an
**Add property** menu at the end of the line, and choosing one opens its editor
straight away.

| Property | Editor |
| --- | --- |
| Lifecycle | A menu: None, In review, Verified, Deprecated, each with a line saying what it means. Verified stamps the signed-in person and today (never typed) and counts as a review; it is disabled, with the reason, on a deprecated page. Deprecated adds **Replaced by** beside the lozenge: the link editor's document search, choosing a page by its title and writing its id. Each choice is one undo step. |
| Owners | A people picker: a token field over the people Quill knows, searched as you type, with avatars and names; arrows to move, Enter to add, Backspace to remove the last; a value that is not a person (a team) can be added as typed. A person is written to front matter as their email address, which is what travels in Git and survives export. |
| Tags | A token field: suggestions from the organisation's labels (ADR-037) and the document's own tags, Enter or comma to add, Backspace to remove the last, and a pasted comma-separated list becomes several tags. A tag that matches a label takes that label's colour. |
| Review | "Review every" as presets (1 month, 3 months, 6 months, 1 year) or a custom interval; "Last reviewed" as a date with a **Reviewed today** action; and the readout of when the next review falls due. |
| Type | A text field, committed on Enter or when the popover closes. |
| Layout | A menu of the block widths (ADR-027). |
| Template answers | By the question's type: a menu for a choice or yes/no, a date for a date, a people picker for a person, a text field otherwise. |

**All properties.** A disclosure at the end of the line opens the full list:
every known property as a labelled row (title included, read-only, because the
first heading is the title, ADR-015), the template's questions, and every key
this release does not model, shown as it is (AGENTS.md rule 7). Power users can
**edit the front matter as YAML** there: the source is validated as YAML before
it is applied, and `id` cannot be changed (decision D17).

**Template questions** are prominent while unanswered: the byline carries "2
questions unanswered" as a button that opens the full list at the questions,
and the list opens by itself when a required question is unanswered or a value
is invalid. An invalid value is visible when the list is closed: its fact in
the byline says what is wrong in words ("Review every: “3 months” is not an
interval").

## Using: keyboard, undo, offline, permissions

- **Keyboard.** Every value is a button in tab order, before the body: Tab
  moves from the properties into the document, Shift+Tab back. Inside a
  popover, arrows move through suggestions and menus, Enter chooses, Escape
  closes and returns focus to the value it came from.
- **Undo.** A property change is an edit of the document's front matter block,
  so it is one step of the editor's own history: Ctrl+Z (⌘Z) undoes it and
  Ctrl+Shift+Z or Ctrl+Y redoes it, from the body or from the properties line.
  The record the draft saves follows the block, so an undone change is undone in
  what is saved and published too.
- **Saving.** A change lands in the local draft at once and is saved with the
  next autosave, like a keystroke in the body: text fields commit on Enter or
  when their popover closes, never per keystroke, and nothing waits on the
  network. Offline, the change is kept with the rest of the unsent edit.
- **Who can edit.** Properties follow the document's edit permission and the
  lock. When they cannot be edited, the values are still shown as text, and a
  line says why ("Alex Chen is editing", "You can read this document but not
  edit it") rather than hiding the controls (`feedback.md`, "Disable or hide").

## Privacy and safety

Property values are user input. They are rendered as text everywhere (React
text nodes; the server templates' escaping `html` tag), never as HTML, and a
tag link's address is built from the value through the URL encoder. The server
still validates front matter against the schema on publish (ADR-005). Owner
lookups are batched (one query per page, never one per owner) and the people
directory is searchable only by someone who can edit the document in question.

## Deferred

- **Properties under the title in the editor.** It needs a widget in the
  writing surface after the first heading. The writing surface is being
  reworked; the strip stays above the title until that lands.
- **Tag suggestions from the whole workspace.** They need a permission-filtered
  tag facet on the search index, so that a tag used only on a page a reader
  cannot see is not revealed. Until then suggestions come from labels and the
  document itself.
- **Approval workflows.** Who may verify, review requests and approvals are
  a later milestone; `canMoveLifecycle` is where such a policy plugs in
  (ADR-005 amendment). A workspace-defined lifecycle vocabulary would be an
  amendment of its own.
