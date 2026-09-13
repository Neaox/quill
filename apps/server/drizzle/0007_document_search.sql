CREATE TABLE IF NOT EXISTS "document_search" (
	"document_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"collection_id" text,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"headings" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"owners" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revision" text,
	"index_version" integer DEFAULT 1 NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("headings", '')), 'B') || setweight(to_tsvector('english', coalesce("body", '')), 'C')) STORED
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_search_document_id_documents_id_fk'
      AND conrelid = 'document_search'::regclass
  ) THEN
    ALTER TABLE "document_search"
      ADD CONSTRAINT "document_search_document_id_documents_id_fk"
      FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_search_workspace_id_workspaces_id_fk'
      AND conrelid = 'document_search'::regclass
  ) THEN
    ALTER TABLE "document_search"
      ADD CONSTRAINT "document_search_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_search_collection_id_collections_id_fk'
      AND conrelid = 'document_search'::regclass
  ) THEN
    ALTER TABLE "document_search"
      ADD CONSTRAINT "document_search_collection_id_collections_id_fk"
      FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_search_vector_idx" ON "document_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_search_workspace_idx" ON "document_search" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_search_collection_idx" ON "document_search" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_search_tags_idx" ON "document_search" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_search_owners_idx" ON "document_search" USING gin ("owners");--> statement-breakpoint
-- Every permission walk asks for the grants the request's own principals hold,
-- wherever they are attached (`listVisibleDocuments`), which is how a workspace
-- of any size is resolved without naming each of its documents in the query.
CREATE INDEX IF NOT EXISTS "grants_principal_idx" ON "grants" USING btree ("principal_id");--> statement-breakpoint
-- Typo tolerance (ADR-010): trigram similarity is what lets a half-remembered,
-- misspelled phrase still find the runbook (use case 20). `pg_trgm` ships with
-- PostgreSQL but installing an extension needs a privilege a hardened or
-- managed deployment may withhold, and search working slightly less well is a
-- far better outcome than a server that will not start. So the extension is
-- attempted, a failure is swallowed, and the index is created only if the
-- extension is really there — `PostgresSearchIndex` asks the same question at
-- runtime and simply leaves the similarity arm out when the answer is no.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm is not available; search will run without typo tolerance (%)', SQLERRM;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "document_search_title_trgm_idx"
      ON "document_search" USING gin ("title" gin_trgm_ops);
  END IF;
END
$$;
