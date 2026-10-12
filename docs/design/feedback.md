# Feedback: toasts, status, and background work

How the product tells a person what is happening. One vocabulary across
reading, writing, and presenting, so nobody has to learn which surface
talks in which way.

## The three channels

| Channel | What it is for | Where it lives |
| --- | --- | --- |
| **Inline status** | The continuous state of the thing on screen: saving, saved, locked by Ada, offline, draft behind the published version. | Next to the thing it describes (the editor status badge, the document header readout). A live region, never a popup. |
| **Toast** | A moment: something finished, failed, or needs a decision, and the person may have moved on from where it started. | The `Toaster` mounted once in the app shell, via the `toast` module in `packages/ui`. |
| **Blocking dialog** | A decision that cannot wait or be undone: discard a draft, take over a lock, resolve a merge. | `Dialog`. Never for information. |

A toast is never the only record of something that matters. If the person
needs to find it later, it is also in the page (a health signal, a revision
entry, an audit row).

## Promise toasts for background work that concerns this page

`toast.promise` is the way to show a background process the current page
depends on: it appears as "doing", becomes "done" or "failed", and the person
keeps working throughout. Use it, and only it, for:

- **Background sync of the document being read** (an external source has
  changed; the mirror is updating; "Updated, reload to see the latest" is the
  resolved state with a reload action).
- **Publish**, **restore**, and **take over lock**, when the result lands on
  the page the person is looking at.
- **Exports** started from the page, resolving to a download action.

Rules:

- The loading text names the thing, not the mechanism: "Updating from the
  source repository", not "Running sync job".
- The resolved state carries the one action that follows naturally (Reload,
  Open, Undo) and nothing else.
- A failure says what to do next, or that nothing is needed ("Your changes are
  kept locally; we will retry").
- One promise toast per process. A retry replaces the toast; it does not stack
  a second one.
- Background work that does **not** concern the current page is not a toast.
  It is a badge on the place it belongs to (the workspace tree, the source's
  settings page) and, if it failed, a notification for the people responsible.

## The control that started the work shows the work

When a click starts something that takes time (submit, publish, restore, take
over a lock, create), the button that was clicked carries the pending state:
`loading` on `Button` swaps its leading icon for a spinner, keeps its width so
nothing shifts, sets `aria-busy`, and refuses further clicks without looking
unavailable. The label stays as it was ("Publish", not "Publishing…") because
the spinner already says so, and a screen reader hears the busy state from the
attribute.

This is the rule for every action a person triggers directly. A promise toast
is for work that continues after the person has moved on, or that they did not
start; it never replaces the spinner on the control they pressed. For a
mutation hook the loading flag is its `isPending`; for an async handler with
no hook, wrap it in React's `useTransition` and pass its pending flag.

## Nothing interactive is inert

A control that can be pressed always does something visible. If the thing it
would do is not available, the control is `disabled` and the reason is
reachable: a tooltip on a wrapper the pointer can still hover, or a line of
text beside it. If the thing it would do is not built yet, the control is not
rendered. A specimen in the design showcase keeps its enabled look, because
the look is the point, and says on press that it is a specimen. There is no
fourth option; a button that swallows a click teaches people not to trust the
next one. The `quill/no-inert-control` lint rule catches the obvious cases.

### Disable or hide: decide by how people use the control

People feel lost when they reach for something they use often and it isn't
there. So the question is not "can this act right now?" but two others:

1. **Is someone likely to reach for it right now, in this context?**
2. **If it weren't here, would they understand why without being told?**

The rules for when a control appears must be intuitive from what is on the
screen, never from state the reader can't see. Layouts stay stable: a
control doesn't move, appear or disappear because of something transient,
such as a save in flight, a dropped connection, or a selection elsewhere.

This is decided once per control from how people use it in general. It is
never tracked per person: Quill doesn't learn what each user clicks to
decide what they see.

With those questions in mind, choose with judgement:

- **Disable it, and say why,** when people use it often or look for it in
  that place. Examples: Publish, Save, Share, Edit, Present, Copy, Restore,
  a toolbar's formatting buttons. If it vanished, people would think it had
  moved or broken, so it stays where they expect it.
  - **Reason in a tooltip:** a native `disabled` button gets no hover or
    focus, so use `aria-disabled="true"`, which keeps it focusable, makes it
    do nothing on press, and keeps the reason in its accessible description.
    Alternatively, wrap it so the tooltip still opens on hover and on
    keyboard focus.
  - **Reason as a line of text** where there is room.
  - **Wording:** the reason says what would make it available, not just
    that it isn't: "Publish needs a title", "Only editors can share this
    page", "You're offline. Saving resumes when you reconnect".
- **Hide it** when it only makes sense in some situations, and the reason
  it's absent is plain from what's on the screen, so its absence costs
  nothing and its presence would only be noise. Examples:
  - "Fit width" in the table viewer when the table visibly already fits;
  - "Next change" when there is one change;
  - a scroll affordance when nothing scrolls;
  - an "Expand" button on a table that needs no room.

  If the reason isn't visible (a permission, a policy, a state elsewhere),
  disable with a reason instead.
  - Hide by removing it or with `hidden`, never by making it invisible but
    focusable.
  - If it disappears while focused, move focus to the nearest sensible
    control, so focus is never lost.
- **Not built yet:** don't render it at all, as above.

When it is unclear which applies, prefer **disabled with a reason**: a
visible "not now, because…" teaches people more than an absence does.

## Moving between pages

A navigation that has to wait, for a code-split route's chunk or for its
data, shows a thin progress bar pinned to the top of the viewport
(`ProgressBar` with `placement="top"`, the router's default pending
component). It appears only after a short delay so an instant navigation
never flashes it, and stays a minimum time once shown so a slow one never
flickers. Links preload their route on hover and focus, so most of the wait
is already over by the time the click lands. Nothing else on the page moves;
the previous page stays put until the next one is ready.

The app shell (top bar, icon rail, navigation sidebar) is rendered once by a
layout route and **never unmounts** while moving between pages inside a
workspace. Pages render only inside its main area; their loading, error, and
not-found states live there too, never as a full-page replacement. A flash of
the shell on navigation is a bug in route structure, and is fixed there, not
with a transition.

## Tone and placement

Tone follows the design tokens, not the message: `success`, `info`, `warning`,
`danger`. Toasts stack bottom-right on wide screens and bottom-centre on
phones, pause on hover and focus, dismiss on swipe, and respect reduced
motion. They are announced through a polite live region; a `danger` toast is
assertive. Duration defaults to a few seconds; a toast with an action stays
until dismissed.

## Two states, one of them on: a switch

A setting with exactly two states, where one of them is plainly "on" (allow share links, enforce AA contrast, lock the layout), is a switch: `ToggleField`, a native checkbox with `role="switch"`, drawn as a track and thumb, with its label and sentence leading and the switch closing the row. It is not a select of two options, and not a checkbox to tick: a select hides the state behind a click, and a checkbox reads as agreeing to something rather than turning it on. A choice between named alternatives that are neither on nor off (centred or beside the navigation, hairlines or cards) stays a radio group.
