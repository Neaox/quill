# ADR-063: Live updates over server-sent events

**Status:** Accepted
**Date:** 2026-11-11
**Related:** ADR-011 (security baseline), ADR-012 (permissions), ADR-021 and ADR-031 (presence: "polling first, server-sent events later"), ADR-032 and ADR-060 (live blocks over server-sent events), ADR-056 (the outbox and the bus), ADR-061 (sources)

## Context

A workspace read from a repository changes without anyone in it doing anything. The repository page, the sidebar tree and an open document all learn about those changes by polling: every 3 seconds while a sync runs, and every 15 seconds for an open document. That is slow to show a sync's end. It also does a lot of work for a page where nothing is happening.

Several ADRs already name server-sent events as the way the app will hear about changes. None of them says how a stream is opened, checked or bounded. This ADR does, for the first stream.

## Decision

**One stream per open workspace.** `GET /api/workspaces/:id/events` is a `text/event-stream` response.
- The workspace layout opens it for a workspace read from a repository. One stream serves the sidebar, the repository page and an open document.
- Only a workspace that reads from a repository has a stream. The route refuses a native workspace with `409`, a disconnected one included (ADR-061, amendment of 11 November 2026).
- Disconnecting the source closes every stream open on the workspace without a message, and the browser falls back to its usual polling.

**The stream says when to ask, never what the answer is.** It has four events:

| Event | Sent when | Data |
| --- | --- | --- |
| `sync` | A sync started, finished or failed | `state`, and `changed` (false for a sync that found nothing new) |
| `document` | A page's head moved | The page's `documentId` and `revision` |
| `tree` | Pages were created, renamed, moved or nested | Nothing |
| `reset` | Too much changed to name | Nothing |

- No message carries a title, a path or a failure's reason.
- The client marks the matching queries stale, and the ordinary routes, with their own checks, answer what changed.
- An open document is never swapped under its reader. A `document` event makes the page ask whether it has moved on, which offers a reload (ADR-061).

**Permissions are checked per reader, per message, at the time it's sent.**
- The stream opens only for a signed-in reader who has `view` on the workspace. Anyone else gets the refusal every workspace route gives, before anything is written.
- Each connection gathers changes for a moment (300 ms). It then checks, as its reader:
  - that the session still stands;
  - that the reader can still see the workspace;
  - that the reader can see each page it would name.
- A page the reader can't see is left out without a trace.
- If the session or the workspace is gone, the stream ends.
- A connection hears only its own workspace's changes. The hub routes by workspace id before any check.

**Events come from the outbox's bus (ADR-056).**
- The stream listens to the in-process bus, which is told after a commit.
- A sync's start and end are a new event, `SourceSyncStateChanged`. It is recorded in the outbox like every event and acknowledged there, since nothing durable acts on it.
- A deletion is not streamed: once a page is gone, there is nothing to check a reader's access against. A sync's end with `changed` refreshes the tree instead.

**Bounded and heartbeated.**
- At most 2,000 streams per process, and 4 per reader (a browser opens 6 connections to a host). A stream past either limit is refused with `429`.
- A comment line every 25 seconds keeps proxies from closing a quiet stream. The same beat re-checks the session and the workspace.
- A stream lasts at most 10 minutes. The server then closes it, and the browser reopens it through the route's checks.
- More than 50 pages changing at once is sent as one `reset`, rather than 50 checks.
- `Connection: close` ends the socket with the stream, and the server ends every stream before it stops.

**Polling stays as the fallback.**
- While the stream isn't open (connecting, reconnecting, or refused), the pages poll at their usual pace.
- While it is open, they slow to a one-minute backstop. That covers changes the stream can't see, such as one committed by another server process.

**Headers and CSP.**
- The stream is same-origin, so `connect-src 'self'` already allows it.
- The security headers set for the request are kept on the response, which is written directly to the socket.
- `X-Accel-Buffering: no` and `Cache-Control: no-store` stop a proxy from holding events back.

## Alternatives considered

- **WebSockets.** Two-way, which nothing here needs. They also need an upgrade path through every proxy, and their own authentication and CSRF handling. Server-sent events are plain HTTP and reuse the session cookie and the route's checks.
- **Putting the change in the message** (the new title, or the new tree). Faster for the reader, but every message would need its own permission-filtered rendering, which the routes already do. A leak would also be a leak of content, not of timing.
- **One stream per document, or per page on screen.** More connections for the same information. Per-reader limits would also bite sooner.
- **Postgres `LISTEN`/`NOTIFY` across processes now.** ADR-056 names it as the next step for the bus. When the bus gains it, the stream hears every process's commits with no change here. Until then, the backstop covers another process's changes.

## Consequences

- A sync's start and end reach every reader of the workspace within a moment. An open document's reload offer arrives without waiting for its next poll.
- With the stream open, an idle page asks the server for nothing but heartbeats.
- Each message costs a few permission checks per connection. Gathering changes for a moment and the `reset` threshold keep a large sync to one burst per reader.
- A second server process is covered by the backstop until the bus crosses processes.
- Presence (ADR-021) and live blocks (ADR-032, ADR-060) should use this route's shape when they arrive: a stream per scope, ids only, and per-message checks.
