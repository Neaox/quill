CREATE TABLE "attachment_revisions" (
	"attachment_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"saved_by" text,
	"saved_at" timestamp with time zone NOT NULL,
	"replaced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attachment_revisions_attachment_id_version_pk" PRIMARY KEY("attachment_id","version")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "revised_by" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachment_revisions" ADD CONSTRAINT "attachment_revisions_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_revisions" ADD CONSTRAINT "attachment_revisions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_revisions_sha256_idx" ON "attachment_revisions" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_revised_by_users_id_fk" FOREIGN KEY ("revised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;