ALTER TABLE "documents" ADD COLUMN "sort_key" integer;--> statement-breakpoint
ALTER TABLE "source_path_map" ADD COLUMN "front_matter_order" integer;--> statement-breakpoint
ALTER TABLE "source_sync_state" ADD COLUMN "layout" jsonb;