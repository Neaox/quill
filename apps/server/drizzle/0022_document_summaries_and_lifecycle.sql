-- Replaces this line of work's own 0014_document_summaries and 0015_document_lifecycle, then its
-- 0019_ and 0021_document_summaries_and_lifecycle, renumbered after main's migrations each time the
-- two were merged. A database that already ran any of those under their old tags has these columns,
-- so each is added only where it is missing.
ALTER TABLE "document_search" ADD COLUMN IF NOT EXISTS "summary" text;--> statement-breakpoint
ALTER TABLE "document_search" ADD COLUMN IF NOT EXISTS "icon" text;--> statement-breakpoint
ALTER TABLE "document_search" ADD COLUMN IF NOT EXISTS "lifecycle" text;