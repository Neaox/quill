CREATE TABLE "secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"rewrapped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "secrets_key_id_idx" ON "secrets" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "secrets_created_at_name_idx" ON "secrets" USING btree ("created_at","name");