ALTER TABLE "grants" ADD COLUMN "principal_kind" text;--> statement-breakpoint
-- Backfilled by hand: the column exists so a check constraint can see what a
-- grant's principal is without reading another table, so every row already in
-- the table has to carry it before that constraint is added.
UPDATE "grants" SET "principal_kind" = "principals"."kind" FROM "principals" WHERE "principals"."id" = "grants"."principal_id" AND "grants"."principal_kind" IS NULL;--> statement-breakpoint
ALTER TABLE "revisions_index" ADD CONSTRAINT "revisions_index_document_id_revision_key" UNIQUE("document_id","revision");--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_deny_is_document_scoped" CHECK ("grants"."effect" <> 'deny' OR "grants"."scope_kind" = 'document');--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_public_is_never_owner" CHECK ("grants"."principal_kind" IS NULL OR "grants"."principal_kind" <> 'public' OR "grants"."role" <> 'owner');
