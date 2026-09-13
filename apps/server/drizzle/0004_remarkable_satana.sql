ALTER TABLE "magic_link_tokens" ADD COLUMN "binding_hash" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
DO $$
DECLARE duplicates text;
BEGIN
  SELECT string_agg(lowered, ', ') INTO duplicates
  FROM (
    SELECT lower(btrim(email)) AS lowered
    FROM users
    GROUP BY 1
    HAVING count(*) > 1
  ) clashes;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot make user emails case-insensitively unique: several accounts share these addresses: %. Merge or rename them, then run the migration again.',
      duplicates;
  END IF;
END
$$;--> statement-breakpoint
UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
UPDATE "documents" SET "parent_id" = NULL WHERE "parent_id" IS NOT NULL AND "parent_id" NOT IN (SELECT "id" FROM "documents");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DELETE FROM "document_locks" WHERE "holder_session_id" NOT IN (SELECT "id" FROM "sessions");--> statement-breakpoint
ALTER TABLE "document_locks" ADD CONSTRAINT "document_locks_holder_session_id_sessions_id_fk" FOREIGN KEY ("holder_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "magic_link_tokens_user_purpose_idx" ON "magic_link_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_expires_at_idx" ON "magic_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");
