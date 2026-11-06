CREATE TABLE IF NOT EXISTS "card_link" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"title" varchar(255) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"cardId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "card_link_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "card_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "driveUrl" varchar(2048);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_link" ADD CONSTRAINT "card_link_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_link" ADD CONSTRAINT "card_link_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_link_card_idx" ON "card_link" USING btree ("cardId");