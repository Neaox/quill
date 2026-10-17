ALTER TABLE "document_search" ADD COLUMN "tag_paths" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "document_search" ADD COLUMN "properties" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Tags are a hierarchy (`/` separates a tag from its parent), and `tag:` is
-- matched against `tag_paths`: every tag and every ancestor of every tag.
-- Rows indexed before this existed are filled from the `tags` they already
-- hold, so nobody has to run `quill reindex` for `tag:area` to find
-- `area/billing`. This mirrors `normaliseTag` and `expandTagPaths`
-- (`@quill/search`): lower case, space trimmed from each segment, empty
-- segments dropped, a tag that is only separators ignored, every prefix of the
-- segments a path. The migration test runs this very statement against seeded
-- rows and compares it to the function.
UPDATE "document_search" AS "ds"
SET "tag_paths" = "expanded"."paths"
FROM (
  SELECT "document_id", array_agg(DISTINCT "path" ORDER BY "path") AS "paths"
  FROM (
    SELECT "tagged"."document_id",
           array_to_string("tagged"."segments"[1:"depth"], '/') AS "path"
    FROM (
      SELECT "split"."document_id", "split"."segments"
      FROM (
        SELECT "d"."document_id",
               ARRAY(
                 SELECT regexp_replace("u"."segment", '^\s+|\s+$', '', 'g')
                 FROM unnest(string_to_array(lower("tag"), '/')) WITH ORDINALITY AS "u"("segment", "position")
                 WHERE regexp_replace("u"."segment", '^\s+|\s+$', '', 'g') <> ''
                 ORDER BY "u"."position"
               ) AS "segments"
        FROM "document_search" AS "d", unnest("d"."tags") AS "tag"
      ) AS "split"
      WHERE cardinality("split"."segments") > 0
    ) AS "tagged", generate_series(1, cardinality("tagged"."segments")) AS "depth"
  ) AS "all_paths"
  GROUP BY "document_id"
) AS "expanded"
WHERE "ds"."document_id" = "expanded"."document_id";--> statement-breakpoint
CREATE INDEX "document_search_tag_paths_idx" ON "document_search" USING gin ("tag_paths");--> statement-breakpoint
-- `properties` (the front-matter keys that are not core fields, for
-- `prop:key=value`) is NOT backfilled: it lives in the content store and
-- cannot be derived in SQL. Existing rows hold `{}` until their document is
-- next published or `quill reindex` runs, and a `prop:` filter finds nothing
-- on them until then. `index_version` is left as it was, so a row that has not
-- been reindexed still says so.
CREATE INDEX "document_search_properties_idx" ON "document_search" USING gin ("properties" jsonb_path_ops);
