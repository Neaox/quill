CREATE TABLE "source_webhook_deliveries" (
	"workspace_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_webhook_deliveries_workspace_id_delivery_id_pk" PRIMARY KEY("workspace_id","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_event_key";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "occurrence" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "source_sync_state" ADD COLUMN "failure_notified" text;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "source_webhook_deliveries" ADD CONSTRAINT "source_webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_webhook_deliveries_received_idx" ON "source_webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_key" UNIQUE NULLS NOT DISTINCT("request_id","recipient_user_id","kind","actor_user_id","occurrence");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (("notifications"."request_id" IS NOT NULL AND "notifications"."document_id" IS NOT NULL) OR ("notifications"."workspace_id" IS NOT NULL AND "notifications"."occurrence" IS NOT NULL));