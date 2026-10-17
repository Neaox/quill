# ADR-052: Events: the outbox is the truth, the bus is the signal

**Status:** Accepted
**Date:** 2026-10-13
**Related:** quill-plan.md section 22 (the outbox is the single event mechanism; no event sourcing); ADR-010, ADR-012, ADR-023, ADR-031, ADR-033, ADR-034; `docs/architecture/patterns.md` (Observer); `AGENTS.md` rules 12, 17 and 19

## Context

The transactional outbox is built and good: an event is written in the same transaction as the change, a poller claims it with `FOR UPDATE SKIP LOCKED`, dispatches it to the consumer registered for its type, retries with backoff, and dead-letters it. Indexing, rendering, redirects and mail run on it.

Four things are not right.

1. **Events are loosely typed.** The writer takes `type: string, payload: unknown`. Each event has a constant, a payload interface, a versioned reader and a parse function, written out by hand each time, and nothing lists every event Quill emits.
2. **A process-local reaction is the wrong shape for the outbox.** The public site's cache is invalidated by outbox consumers. An outbox event is claimed by exactly one poller, so with two servers one of them is told and the other is not. A cache needs every process told, once the change has happened, as fast as the commit.
3. **Some changes emit nothing.** A grant written or revoked, and a document or collection deleted, produce no event, so what is derived from them (the public cache, later the effective-permission table) catches up by time to live alone. That is a stale permission cache, which is a disclosure rather than a slow query (plan section 15).
4. **A use case can forget.** Writing the outbox row and telling anything else are separate calls, so "the path that forgot to invalidate" is possible by construction.

## Decision

**Two kinds of listener, one kind of source.**

- **The outbox stays the source of truth** and is unchanged as a mechanism. Durable work, work that must happen once and survive a crash, is an outbox consumer: indexing, rendering, mail, the effective-permission rebuild, notifications, sync, webhooks.
- **An in-process `EventBus` is a signal that a commit happened.** `subscribe(definition, listener)` returns the unsubscribe (the Observer shape in the patterns catalogue). It is for work that is safe to lose because something else heals it: invalidating a process's own caches, and later pushing to live readers. A listener that must not be lost is a consumer, not a subscriber.

**An event is defined once.** `defineEvent(type, readers)` returns one value carrying the type name, the current version, and the versioned reader (ADR-033). The constant, the parse function and the payload type all come from it, so adding an event is adding one definition, and the catalogue in `use-cases/events.ts` is the list of what Quill emits.

**There is one way to emit.** A use case calls `tx.events.record(definition, payload, now)`. That writes the outbox row in the transaction and remembers the event for publication, so a use case cannot do one without the other. The low-level `OutboxWriter` is no longer on the repository bundle.

**Nothing is published before the commit.** A unit of work collects what its transaction recorded and publishes it to the bus after the transaction commits, and discards it if the transaction rolls back. A listener never sees an event whose change did not happen. Publication is awaited, so a request that revokes access has already cleared the caches by the time it answers; a listener is therefore quick, and its failure is reported and isolated rather than failing the request, because the change has already been committed.

**A cache is told by the bus, not by a consumer.** The public site cache subscribes to the events that change what a site shows, in one place. Its time to live stays as the backstop for what no event covers.

**Events added with this decision:** `GrantCreated`, `GrantRevoked`, `DocumentDeleted`, `CollectionDeleted` (plan section 22 names the first two as `GrantChanged`; they are two events because the effective-permission rebuild treats them differently, and because a revoke is the one that must not be late).

## Alternatives considered

- **An in-process emitter only.** Lossy: a crash between the commit and the emit loses the event for ever, and a derived store is silently wrong. Fine as a signal, wrong as the record.
- **The outbox only.** Reliable but late: the poller's interval is the delay between revoking access and the cache knowing, and one poller serves one process.
- **An external broker.** Redis, NATS or Kafka add a service every self-hoster must run (decision D10, `AGENTS.md` rule 11) for a need the database already meets.
- **Subjects and streams (Rx).** A second observer idiom beside the one the catalogue names. One shape is easier to read and to test.
- **Event sourcing.** Rejected by the plan.

## Consequences

- **A process-local cache is told in the process that made the change.** Another server instance learns by time to live until a cross-instance signal exists. The planned signal is a Postgres `NOTIFY` carrying only the event id and type, which wakes every instance's bus and the poller. It needs no new service and is the next step, not part of this decision's first slice.
- **Per-consumer delivery is still deferred.** `combineConsumers` runs several consumers of one type as one, so they succeed or fail together. A delivery row per consumer is worth building when the first consumer that is not idempotent arrives (a webhook); the outbox README says why and how.
- **The first slice changes how the existing events are written, not what they mean.** Each keeps its type string and payload shape (ADR-033), and its parse function keeps its name.
- **Testing:** a definition's reader is tested like any versioned format; a use case is tested by what it recorded (`uow.events`); the bus is tested by subscription, isolation and unsubscribe; the unit of work is tested by publishing after commit and not on rollback.
