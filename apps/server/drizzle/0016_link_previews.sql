CREATE TABLE "link_previews" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"state" text NOT NULL,
	"document" jsonb,
	"failure" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone,
	"retry_after" timestamp with time zone,
	CONSTRAINT "link_previews_scope_key_pk" PRIMARY KEY("scope","key")
);
