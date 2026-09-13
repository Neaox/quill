CREATE TABLE IF NOT EXISTS "workspace_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"retired_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_slug_history_workspace_id_workspaces_id_fk'
      AND conrelid = 'workspace_slug_history'::regclass
  ) THEN
    ALTER TABLE "workspace_slug_history"
      ADD CONSTRAINT "workspace_slug_history_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_slug_history_workspace_idx" ON "workspace_slug_history" USING btree ("workspace_id");--> statement-breakpoint
-- Expand only (ADR-033): the column arrives nullable, every existing row is
-- given a key, and only then does it become NOT NULL. Adding it NOT NULL in
-- one step, as drizzle-kit generates it, would refuse to run on any database
-- that already holds a document.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "short_id" text;--> statement-breakpoint
-- Backfilled here rather than by a migrator step so that a database is
-- upgraded by applying the migrations, whatever applies them (ADR-035).
-- Ten characters of the Crockford base-32 alphabet, drawn per row — the key
-- is generated inside the loop rather than by one set-returning expression,
-- because a single uncorrelated subquery would be evaluated once and give
-- every row the same key. Re-running this changes nothing: only rows without
-- a key are touched.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  target record;
  candidate text;
  attempts integer;
  character_index integer;
BEGIN
  FOR target IN SELECT id FROM documents WHERE short_id IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := '';
      FOR character_index IN 1..10 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM documents WHERE short_id = candidate);
      IF attempts >= 20 THEN
        RAISE EXCEPTION 'Could not find a free short id for document % after % attempts', target.id, attempts;
      END IF;
    END LOOP;
    UPDATE documents SET short_id = candidate WHERE id = target.id;
  END LOOP;
END
$$;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "short_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_short_id_key' AND conrelid = 'documents'::regclass
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_short_id_key" UNIQUE("short_id");
  END IF;
END
$$;
