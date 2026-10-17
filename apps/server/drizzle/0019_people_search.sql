ALTER TABLE "document_search" ADD COLUMN "contributor_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "document_search" ADD COLUMN "contributors_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "document_search_contributor_emails_idx" ON "document_search" USING gin ("contributor_emails");--> statement-breakpoint
-- Rows indexed before `by:` and `team:` existed are filled from the revisions
-- they were projected from, so nobody has to run `quill reindex` for the
-- filters to work on what is already there. Revisions are the source: one row
-- per address, under the name last published with, exactly what
-- `RevisionsIndexRepository.listContributors` answers for a single document.
UPDATE "document_search" AS "ds"
SET "contributor_emails" = "c"."emails",
    "contributors_text" = "c"."lines",
    "index_version" = 2
FROM (
  SELECT "document_id",
         array_agg("email" ORDER BY "email") AS "emails",
         string_agg("name" || ' ' || "email", E'\n' ORDER BY "email") AS "lines"
  FROM (
    SELECT DISTINCT ON ("document_id", lower(trim("author_email")))
           "document_id",
           lower(trim("author_email")) AS "email",
           lower(trim("author_name")) AS "name"
    FROM "revisions_index"
    ORDER BY "document_id", lower(trim("author_email")), "timestamp" DESC, "id" DESC
  ) "latest"
  GROUP BY "document_id"
) AS "c"
WHERE "ds"."document_id" = "c"."document_id";--> statement-breakpoint
-- `by:` with part of a name is a substring match, which a trigram index
-- answers. As with the title's (0007), the extension is optional: where it
-- could not be installed the filter still works, a scan slower.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "document_search_contributors_text_trgm_idx"
      ON "document_search" USING gin ("contributors_text" gin_trgm_ops);
  END IF;
END
$$;
