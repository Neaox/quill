CREATE TABLE "source_path_map" (
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"document_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_path_map_workspace_id_path_pk" PRIMARY KEY("workspace_id","path"),
	CONSTRAINT "source_path_map_document_id_key" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "source_sync_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"last_synced_revision" text,
	"last_synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"failure" jsonb,
	"refused" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_path_map" ADD CONSTRAINT "source_path_map_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_path_map" ADD CONSTRAINT "source_path_map_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_state" ADD CONSTRAINT "source_sync_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revisions_index_source_revision_idx" ON "revisions_index" USING btree ("workspace_id","source_revision") WHERE "revisions_index"."source_revision" IS NOT NULL;