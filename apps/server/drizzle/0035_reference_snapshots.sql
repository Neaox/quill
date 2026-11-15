CREATE TABLE "reference_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_commit" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"artifact_hash" text NOT NULL,
	"artifact_size" integer NOT NULL,
	"artifact_version" integer NOT NULL,
	"symbol_count" integer DEFAULT 0 NOT NULL,
	"table_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reference_snapshots_source_key" UNIQUE("workspace_id","kind","source_commit","captured_at"),
	CONSTRAINT "reference_snapshots_kind" CHECK ("reference_snapshots"."kind" IN ('code', 'schema')),
	CONSTRAINT "reference_snapshots_sizes" CHECK ("reference_snapshots"."artifact_size" >= 0 AND "reference_snapshots"."artifact_version" >= 1 AND "reference_snapshots"."symbol_count" >= 0 AND "reference_snapshots"."table_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reference_snapshots" ADD CONSTRAINT "reference_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_snapshots_latest_idx" ON "reference_snapshots" USING btree ("workspace_id","kind","captured_at");