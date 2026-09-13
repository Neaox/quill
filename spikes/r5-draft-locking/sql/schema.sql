-- Spike R5: draft and locking model (ADR-021).
-- Runs entirely inside a dedicated schema so it never touches real Quill data.

CREATE SCHEMA IF NOT EXISTS spike_r5;

-- One row per document. Acquire/renew/release/takeover all operate on this table.
CREATE TABLE IF NOT EXISTS spike_r5.document_lock (
  document_id        text PRIMARY KEY,
  holder_user_id      text NOT NULL,
  holder_session_id   text NOT NULL,
  acquired_at         timestamptz NOT NULL,
  last_heartbeat_at   timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL
);

-- One row per document. draft_version increments on every accepted write.
CREATE TABLE IF NOT EXISTS spike_r5.draft (
  document_id     text PRIMARY KEY,
  draft_version   integer NOT NULL DEFAULT 0,
  base_revision   text,
  ast             jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
