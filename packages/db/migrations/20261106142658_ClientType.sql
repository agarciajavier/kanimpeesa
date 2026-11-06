CREATE TYPE "public"."client_type" AS ENUM('management', 'advisory');--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "type" "client_type";