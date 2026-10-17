CREATE TABLE "document_views" (
	"user_id" text NOT NULL,
	"document_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"last_viewed_at" timestamp with time zone NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_views_user_id_document_id_pk" PRIMARY KEY("user_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "revisions_index" ADD COLUMN "author_user_id" text;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_views_user_recent_idx" ON "document_views" USING btree ("user_id","last_viewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "document_views_last_viewed_idx" ON "document_views" USING btree ("last_viewed_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions_index" ADD CONSTRAINT "revisions_index_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;