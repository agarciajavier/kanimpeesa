CREATE TYPE "public"."client_status" AS ENUM('starting', 'ok', 'at_risk', 'critical');--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "status" "client_status" DEFAULT 'starting' NOT NULL;--> statement-breakpoint
-- Impeesa: colourCode follows status; existing clients start as "starting".
UPDATE "client" SET "colourCode" = '#0ea5e9';
