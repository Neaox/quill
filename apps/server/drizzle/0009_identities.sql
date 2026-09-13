-- Federated identities (ADR-011).
--
-- Expand only (ADR-033): a new table and nothing else. No existing column
-- changes type or nullability, so an older release keeps running against a
-- database this has been applied to.
CREATE TABLE IF NOT EXISTS "identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_sign_in_at" timestamp with time zone
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'identities_user_id_users_id_fk'
      AND conrelid = 'identities'::regclass
  ) THEN
    ALTER TABLE "identities"
      ADD CONSTRAINT "identities_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
-- The identity is `(issuer, subject)` and not `(provider_id, subject)`: two
-- configured providers pointed at one directory are one directory, and
-- keying on the configured id would let the same person hold two accounts
-- (ADR-011).
CREATE UNIQUE INDEX IF NOT EXISTS "identities_issuer_subject_key" ON "identities" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identities_user_id_idx" ON "identities" USING btree ("user_id");
