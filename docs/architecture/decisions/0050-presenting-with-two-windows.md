# ADR-050: Presenting with two windows

**Status:** Accepted
**Date:** 2026-10-12
**Related:** ADR-013 (URL state), ADR-029 (template model: presenter notes), ADR-031 (render caching), ADR-042 (link previews); `quill-plan.md` section 14

## Context

Presentation mode (section 14) is one window: the document's sections as steps at projector scale. Presenter notes came from a `:::notes` directive, kept out of every reader surface, and were shown by pressing `N`. They appeared as a card **in the presented window**, so on a projector, or over a screen share, the room saw what only the presenter should. The one place notes were meant never to be seen was the one place they were drawn.

A presenter needs two things the room does not: the notes, and what comes next. The established answer (Keynote, PowerPoint, Google Slides) is a second window: the audience's, which goes to the projector or is the one that is shared, and the presenter's, which stays on the presenter's own screen. The two follow each other.

## Decision

### Two ways to present, and the choice is visible

- **Single window** is the default: the presentation is the whole screen, with the chrome that fades, and **nothing the room must not see is ever drawn in it**. The notes card is removed from this window; `N` no longer draws anything on the projector.
- **Presenter view** is a second, separate window opened from the first: `Presenter view` in the presenter bar (key `P`, and `N`, which people already press for notes). The window that was presenting is now the **audience window**: put it on the projector, or share only it. The presenter window shows the current section, the next section, the notes for this one, a clock, and the controls.

The bar says which mode it is in: a two-button choice, **Single window** and **Presenter view**, one of which is pressed, and when the presenter window is open the second reads "Presenter view open" with a way to close it. There is no mode a presenter can be in without the bar saying so.

A presenter window is also reachable on its own (`?view=presenter`), which is how it is restored by a reload, and why it works when only that window is open.

### The two windows follow each other over a `BroadcastChannel`

Both windows are the same origin in the same browser, which is what `BroadcastChannel` is for: no server, no sockets, no round trip, and nothing leaves the machine. The channel is named for the document (`quill-present:<document id>`), so two presentations never hear each other.

Messages are small and say only what is needed to follow along:

| Message | From | Meaning |
| --- | --- | --- |
| `hello` | a window that has just opened | I am here (`role`: audience or presenter) and am on this step of this revision. |
| `step` | a window whose step changed | The presentation is now on step `index` of `revision`. |
| `blank` | a window whose black screen changed | The room's screen is now black (or back). `B` and `.` (which most clickers send) toggle it; Escape or the next key brings it back, and the next key goes on. Either window can blank the room; only the audience window draws it, and a window that opens late is told. |
| `bye` | a window that is closing | I have gone. |

Either window drives; the other follows. A window that receives `hello` answers with the step it is on, so a window opened late (or reloaded) joins where the room is, and a window that receives `step` for another revision says so rather than showing a different deck. Each message carries its sender's id and a following window never re-announces what it was told, so two windows cannot echo each other into a loop. The step stays in the URL of each window (`?step=`, ADR-013); the channel carries it between them, and nothing else is authoritative.

What it does not do is cross a browser, a profile or a device. Presenting from a phone, or from another computer, needs the server in the middle; that is a later decision (a short-lived session channel) and nothing here stands in its way, because the messages above are the whole protocol.

### Media

The audience window is the one that plays. The presenter window shows what the room will see, never plays it:

- **Pictures, diagrams and animated images** are drawn in both; in the presenter window an animated image is held still (the same still a reader who asks for less motion gets).
- **Video and audio** (when documents carry them; today the sanitiser allows neither) play only in the audience window, so there is never sound from two. In the presenter window a video is its poster and a play control, and the control *asks the audience window* to play, pause or seek, over the same channel (`media` messages, a later addition to the table above, with the element named by its position in the step).
- **Embeds** (ADR-042) are sandboxed frames, and a frame is loaded once, in the audience window. The presenter window shows the embed's card (title and address), not the frame.
- Full screen is asked for by each window on its own press: a browser allows it only on a user gesture, and a presenter window rarely wants it.

### The Presentation API, when it can be used

The [Presentation API](https://developer.mozilla.org/en-US/docs/Web/API/Presentation_API) is the browser's own answer to "put this page on the other display": a controller page asks (`new PresentationRequest([url])`, `start()`), the browser lets the person pick a display, and a receiver page loads there; the two talk over a `PresentationConnection` (`send` and `message` events). It is a better way to *place* the audience window than `window.open`, and it fits this design without changing it:

- The audience window is the **receiver** and the presenter window the **controller**. The protocol is already transport-agnostic: `PresentChannel` is `post` / `subscribe` / `close` over JSON messages, built on `BroadcastLike` (`postMessage`, `message` events, `close`). A connection is the same shape with `send` for `postMessage`, so the second transport is an adapter of a few lines, chosen where the channel is made; the hook, the messages, the handshake and the loop-avoidance do not change.
- A receiver is a **separate browsing context**, and for a remote display (a cast device) it has no cookies at all. It cannot rely on the signed-in session the way a second window of the same browser does: it would be opened on a short-lived address for presenting that one document, as a share link is. That is the real work, and it is the same work a presenter on another computer needs.
- It is Chromium-only today, and needs a display the browser can see. So it is an **addition**: `window.open` and the channel stay as the default and the fallback, and "Present on a display" is offered only where `PresentationRequest.getAvailability` says there is somewhere to send it.
- Media rules are unchanged: the receiver is the audience window, and the only one that plays.

## Consequences

- A presenter who has one screen presents from two windows on it and shares only the audience window; nothing needs a second monitor.
- The notes are read in the presenter window from the published source, as they were (`presenter-notes.ts`); no route or renderer changes, and nothing can put them in a reader's page.
- `window.open` needs a user gesture; it is only ever called from a press or a key. A browser that blocks the popup is told so in words, with the address to open by hand.
- The notes panel and its "note for later" stub move to the presenter window, where the stub's own reason ("only you see this") is true.

## Alternatives considered

- **Notes as an overlay in the one window, toggled.** What it was. Anything drawn in the shared window is seen.
- **The Presentation API (a second display).** Needs a connected display the browser can see, is Chromium-only, and does nothing for a presenter with one screen. It can be a later way to *place* the audience window, not a replacement for the second window.
- **`postMessage` through `window.opener`.** Ties the windows to who opened whom, and breaks on reload; the channel does not care who opened what.
- **The server as the hub from the start.** Right for remote control and for a presenter on another machine, and a round trip and an auth surface for every step of the common case.

## Amendment, 2026-10-12: a presenter's window that can be used, and that fits

**The slide being shown is the largest thing in the window, and the next is small.** Shown at equal size they were two small pictures, and neither could be read. Now, by the window's own size: on a narrow window the slide is as large as the width allows but no taller than a third of the window, with the notes below and the next section as words; on a medium one the slide is larger and the next section is a small picture beside its title; on a wide one the slide takes the left, as large as the width and height allow, and the notes take the top of the right with the next section's small picture under them. The next picture is never larger than 12rem wide.

**A section with no notes gives their room to the slide.** The stage says whether there are notes to make room for (`data-notes`), and without them the notes panel becomes one line under the slide, so a speaker who is speaking to the slides has them at the full width and height of the window.

**The slide being shown can be used; the next cannot.** A presenter sharing this window over a call has no other way to enlarge a picture, follow a link, fold a detail or copy code in front of the room. So the current slide is live: its pictures open full screen in the viewer a diagram opens in, with the same zoom, pan and keys (`lightbox/images.ts`, opt-in through `DocumentBody`'s `expandImages`); its links open in a new tab, so following one never takes the presenter out of the window they are presenting from; a section taller than the slide scrolls inside it. The next slide stays inert and hidden from assistive technology, which would otherwise read the section twice.

**Keys and the wheel are the control's or the viewer's when they are.** Space or Enter on a focused picture, link or button presses it rather than stepping, and every key inside the viewer is its own (Escape closes it, the arrows pan the picture) instead of stepping the presentation or closing the window (`key-owner.ts`). A turn of the wheel that something already used, such as zooming a picture, does not step.


**Sections that open and fold are kept the same in both windows, from the moment a window arrives.** The presenter window's current slide is live, so a presenter who opens an accordion item there did so only on their own screen while the room looked at the audience window. A `details` message (`step`, `revision`, `open`) carries it: `open` is whether each of the slide's sections is open, in order, which names the same sections in both windows because both draw the same HTML, and a slide is marked `data-step` (the next-slide picture is not, so it neither speaks nor is spoken to). The whole row is sent rather than one section, because an accordion's items close each other and a window told only "this one opened" would be left with another open. It is sent after the click that opens or folds a section, not from the browser's `toggle` event, which also fires for a section that is open when drawn and for one the other window just changed, and could undo a choice. A window told to change a section sets it without a click, so nothing is sent back. Each window remembers the rows it has seen and draws them onto a slide whenever the slide is drawn (`DocumentBody`'s `onMounted`), so going back to a slide finds its sections as they were left; and a window that says `hello` is answered with every row the room has changed, so one that opens late or reloads joins with the same sections open. A window on another revision ignores them.

**Slides taller than the window are one long surface.** Anything that moves up and down treats the slides as laid end to end: the wheel, Arrow Down and Up, Page Down and Page Up, and Space (Shift+Space back) scroll the slide being shown while there is more of it that way, and only at its end go on to the next slide, arriving at its **top**, or back to the previous, arriving at its **bottom**, so the scrolling carries on as if the slides were one page (`slide-scroll.ts`). Left and Right, Home, End, the rail and go-to go to a slide as such and arrive at its top. The window that did not move follows to the same end (the `step` message carries `entry`). What scrolls is the live slide in the presenter window and the page in the audience window. A slide that fits its window never scrolls, so on those Page Down and Page Up are exactly next and previous, which is what a presentation remote sends; on a tall one they scroll first, as a browser's do, and are the only way a remote reaches the foot of it. A held key keeps scrolling but never runs on through the deck. The tail of a wheel swipe that has just stepped is not allowed to scroll the new slide, and a slide entered from below is kept at its foot while a diagram or picture is still taking its size.
