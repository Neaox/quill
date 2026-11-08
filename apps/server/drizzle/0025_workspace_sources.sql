CREATE TABLE "workspace_sources" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"remote" text NOT NULL,
	"branch" text NOT NULL,
	"collections" jsonb NOT NULL,
	"history" text NOT NULL,
	"commit_messages" text NOT NULL,
	"credential_username" text,
	"credential_secret" text,
	"configured_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_sources_history_check" CHECK ("workspace_sources"."history" IN ('full', 'head')),
	CONSTRAINT "workspace_sources_commit_messages_check" CHECK ("workspace_sources"."commit_messages" IN ('subject', 'none')),
	CONSTRAINT "workspace_sources_credential_check" CHECK (("workspace_sources"."credential_username" IS NULL) = ("workspace_sources"."credential_secret" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_configured_by_users_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;