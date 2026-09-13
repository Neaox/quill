-- Share links (plan section 14).
--
-- Expand only (ADR-033). The first migration shipped `share_links` as a
-- placeholder with `scope_kind`, `scope_id` and `password_hash`; nothing has
-- ever inserted a row, because until now no code path could. Those three
-- columns are made nullable and left in place for the contract step after
-- this release rather than dropped here.
--
-- The new columns are added nullable, backfilled, and only then made NOT
-- NULL, so this runs on a table with rows as readily as on the empty one
-- every deployment actually has. A backfilled `scope_id` that names no
-- document fails at the foreign key below, loudly, rather than being
-- discarded.
ALTER TABLE "share_links" ALTER COLUMN "scope_kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "scope_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
UPDATE "share_links" SET "document_id" = "scope_id", "scope" = 'document' WHERE "document_id" IS NULL;--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_links_document_idx" ON "share_links" USING btree ("document_id");
