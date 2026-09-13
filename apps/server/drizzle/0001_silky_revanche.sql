CREATE TABLE "document_links" (
	"id" text PRIMARY KEY NOT NULL,
	"source_document_id" text NOT NULL,
	"target_document_id" text,
	"url" text NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"render_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "head_revision" text;--> statement-breakpoint
ALTER TABLE "organisational_units" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisational_units" ADD COLUMN "label" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_target_document_id_documents_id_fk" FOREIGN KEY ("target_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_cache" ADD CONSTRAINT "render_cache_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_links_source_idx" ON "document_links" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "document_links_target_idx" ON "document_links" USING btree ("target_document_id");--> statement-breakpoint
CREATE INDEX "render_cache_document_idx" ON "render_cache" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "grants_scope_idx" ON "grants" USING btree ("scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "group_members_user_id_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "revisions_index_document_idx" ON "revisions_index" USING btree ("document_id","timestamp");