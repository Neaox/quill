---
title: "Runbook: search index rebuild"
id: 01J8Z1ABCD2EFGH3IJKL4MNOP5
owner: platform
severity: sev2
layout: full
oncall:
  primary: platform-oncall
  escalation: platform-lead
lastReviewed: 2026-07-30
---

# Runbook: search index rebuild

Source: written for this spike, in the shape of an internal SRE runbook.

:::callout{type=warning}
A full rebuild takes about 40 minutes and degrades search for the duration.
Announce it in `#eng-announce` first.
:::

## When to run this

- Search results are stale by more than one hour.
- The `search_index_lag_seconds` alert has been firing for 15 minutes.
- After a schema migration that touches `documents` or `document_revisions`.

## Preconditions

1. You have `platform:write` in the target workspace.
2. The nightly backup for today has completed.
3. No deploy is in flight.

## Procedure

1. Scale the indexer down to zero:

   ```bash
   kubectl -n quill scale deploy/indexer --replicas=0
   ```

2. Truncate the index:

   ```sql
   truncate table search_index;
   ```

3. Enqueue a full reindex:

   ```bash
   quillctl reindex --workspace all --batch-size 500
   ```

4. Scale back up and watch the lag metric:

   ```bash
   kubectl -n quill scale deploy/indexer --replicas=4
   ```

:::wide
| Step | Expected duration | Alert to silence |
| ---- | ----------------: | ---------------- |
| Scale down | < 1 min | `indexer_down` |
| Truncate | < 1 min | — |
| Reindex | 30–40 min | `search_index_lag_seconds` |
| Scale up | < 2 min | — |
:::

## Rollback

There is no rollback. If the rebuild fails part way, re-run step 3; the job is
idempotent.

## Escalation

> If lag is still above 600 s one hour after the rebuild completes, page the
> platform lead.

<!-- Reviewed 2026-07-30 by @ops -->
