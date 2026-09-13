CREATE TABLE "public_redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"site_slug" text NOT NULL,
	"path" text NOT NULL,
	"document_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_redirects_site_slug_path_key" UNIQUE("site_slug","path")
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "public_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "public_site_slug" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "public_home_document_id" text;--> statement-breakpoint
ALTER TABLE "public_redirects" ADD CONSTRAINT "public_redirects_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_redirects_document_idx" ON "public_redirects" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_public_home_document_id_documents_id_fk" FOREIGN KEY ("public_home_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_public_site_slug_key" UNIQUE("public_site_slug");