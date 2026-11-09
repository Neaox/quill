CREATE TABLE "source_assets" (
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"attachment_id" text NOT NULL,
	"file_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_assets_workspace_id_path_pk" PRIMARY KEY("workspace_id","path")
);
--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source_workspace_id" text;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_workspace_id_workspace_sources_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace_sources"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_source_workspace_id_workspace_sources_workspace_id_fk" FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspace_sources"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_source_sha256_idx" ON "attachments" USING btree ("source_workspace_id","sha256");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_check" CHECK (("attachments"."document_id" IS NULL) <> ("attachments"."source_workspace_id" IS NULL));