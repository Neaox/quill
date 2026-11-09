CREATE TABLE "source_asset_holders" (
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"attachment_id" text NOT NULL,
	CONSTRAINT "source_asset_holders_workspace_id_path_attachment_id_pk" PRIMARY KEY("workspace_id","path","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "source_image_references" (
	"workspace_id" text NOT NULL,
	"document_id" text NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "source_image_references_workspace_id_path_document_id_pk" PRIMARY KEY("workspace_id","path","document_id")
);
--> statement-breakpoint
ALTER TABLE "source_asset_holders" ADD CONSTRAINT "source_asset_holders_workspace_id_workspace_sources_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace_sources"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_asset_holders" ADD CONSTRAINT "source_asset_holders_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_image_references" ADD CONSTRAINT "source_image_references_workspace_id_workspace_sources_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace_sources"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_image_references" ADD CONSTRAINT "source_image_references_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_asset_holders_attachment_idx" ON "source_asset_holders" USING btree ("attachment_id");