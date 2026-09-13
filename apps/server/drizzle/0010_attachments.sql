-- Attachments (plan §11, ADR-011 uploads, ADR-034 the blob store as a system
-- of record).
--
-- Expand only (ADR-033): a new table, and one index on a column that already
-- exists. No existing column changes type or nullability, so an older release
-- keeps running against a database this has been applied to.
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"uploaded_by" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attachments_document_id_documents_id_fk'
      AND conrelid = 'attachments'::regclass
  ) THEN
    ALTER TABLE "attachments"
      ADD CONSTRAINT "attachments_document_id_documents_id_fk"
      FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attachments_workspace_id_workspaces_id_fk'
      AND conrelid = 'attachments'::regclass
  ) THEN
    ALTER TABLE "attachments"
      ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
-- Null rather than cascade: the attachment belongs to the document, not to
-- whoever happened to upload it, and outlives their account.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attachments_uploaded_by_users_id_fk'
      AND conrelid = 'attachments'::regclass
  ) THEN
    ALTER TABLE "attachments"
      ADD CONSTRAINT "attachments_uploaded_by_users_id_fk"
      FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_document_idx" ON "attachments" USING btree ("document_id");--> statement-breakpoint
-- Which rows still need an object, for the sweep that will one day collect
-- the objects nothing points at any more.
CREATE INDEX IF NOT EXISTS "attachments_sha256_idx" ON "attachments" USING btree ("sha256");--> statement-breakpoint
-- A delete asks "does any published revision still link to this attachment?",
-- which is a lookup by URL across a workspace's links.
CREATE INDEX IF NOT EXISTS "document_links_url_idx" ON "document_links" USING btree ("url");
