# Outbox consumers

An event is written in the same transaction as the change it reports (plan
§22); a consumer is what acts on it afterwards. `poller.ts` claims a batch of
due events with `FOR UPDATE SKIP LOCKED`, dispatches each to the consumer
registered for its type, and records the outcome in the transaction that
claimed it — at-least-once delivery, with exponential backoff and, eventually,
a dead letter.

| File | What it is |
| --- | --- |
| `consumer.ts` | The `OutboxConsumer` contract: an event type, a handler, and an optional redaction of the stored payload. |
| `poller.ts` | One poll cycle: claim, dispatch, retry, dead-letter. |
| `render-on-publish.ts` | Renders the published body so the first reader never pays for a render (ADR-031). |
| `index-on-publish.ts` | Puts the published document into the search index, and re-indexes a renamed one (ADR-010). |
| `send-mail.ts` | Delivers queued mail, and redacts the token out of the row afterwards (ADR-011). |
| `acknowledge.ts` | A consumer that deliberately does nothing, for a type nothing acts on yet. |
| `combine.ts` | Several consumers of one event type, as the one consumer the runner registers. |

## Two things on one event share a failure domain

The job runner keys its registry by event type, because the poller claims only
the types something is registered for. That is the right shape for claiming
and the wrong shape for the moment a second thing has to happen on a publish:
registering the search indexer beside the renderer would silently replace it.
`combineConsumers` is the answer — "both, in this order" said out loud rather
than a registry that holds lists and runs them in an order nobody wrote down.

The consequence is worth stating plainly, because it is a real cost and not an
oversight: **rendering and indexing a publish now succeed or fail together.**
The consumers run in order and the first failure stops the rest, so a search
index that cannot be written fails the event, and the event is retried whole —
including the render that had already succeeded. Ten failures apart, the event
dead-letters and *neither* the body nor the index entry is up to date for that
publish, where previously an unrelated failure in one could not have touched
the other.

That is acceptable here because of what these two consumers are. Both are
idempotent — the render is content-addressed (ADR-031) and the index write is
an upsert — so redoing the successful half costs a little work and changes
nothing. Both are indexes rather than systems of record (ADR-034), so a
dead-lettered publish loses no content: `quill reindex` rebuilds the search
index and the render cache from the content store, which is exactly the
recovery an operator reaches for when they find the dead letter. And the
failure modes overlap almost entirely — both write to the same PostgreSQL —
so the independence being given up is largely notional.

The alternative, if that stops being true, is a registry of lists per event
type with per-consumer acknowledgement: each consumer's outcome recorded
separately, so a retry runs only the ones that failed. That is a change to the
poller's bookkeeping — an `outbox_deliveries` row per consumer rather than a
`processed_at` per event — and it is worth making the day a consumer appears
that is *not* idempotent, *not* a rebuildable index, or talking to something
other than the database everything else already depends on. A webhook consumer
would be all three.
