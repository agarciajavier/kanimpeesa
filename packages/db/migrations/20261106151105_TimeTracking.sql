CREATE TYPE "public"."time_entry_source" AS ENUM('timer', 'manual');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"cardId" bigint NOT NULL,
	"clientId" bigint,
	"userId" uuid NOT NULL,
	"source" time_entry_source DEFAULT 'timer' NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"endedAt" timestamp with time zone,
	"note" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	CONSTRAINT "time_entry_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "monthlyFee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "feeCurrency" varchar(3) DEFAULT 'ARS' NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "contractedHours" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "hourlyCost" numeric(12, 2);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_clientId_client_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_workspace_started_idx" ON "time_entry" USING btree ("workspaceId","startedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_card_idx" ON "time_entry" USING btree ("cardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_client_idx" ON "time_entry" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_user_idx" ON "time_entry" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_entry_one_running_per_user_idx" ON "time_entry" USING btree ("userId") WHERE "time_entry"."endedAt" IS NULL AND "time_entry"."deletedAt" IS NULL;