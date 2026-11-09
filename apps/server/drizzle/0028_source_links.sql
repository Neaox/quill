ALTER TABLE "source_sync_state" ADD COLUMN "broken_links" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD COLUMN "outside_links" text DEFAULT 'forge' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD COLUMN "view_template" text;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_outside_links_check" CHECK ("workspace_sources"."outside_links" IN ('forge', 'text'));