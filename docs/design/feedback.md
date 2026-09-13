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
