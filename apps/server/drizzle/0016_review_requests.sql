CREATE TABLE "review_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"position" integer NOT NULL,
	"principal_kind" text NOT NULL,
	"principal_id" text NOT NULL,
	"state" text NOT NULL,
	"decided_by" text,
	"comment" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "review_assignments_request_principal_key" UNIQUE("request_id","principal_kind","principal_id")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"draft_version" integer NOT NULL,
	"message" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_assignments_principal_idx" ON "review_assignments" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_one_active_idx" ON "review_requests" USING btree ("document_id") WHERE "review_requests"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_requests_document_idx" ON "review_requests" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "review_requests_requested_by_idx" ON "review_requests" USING btree ("requested_by");