CREATE TABLE IF NOT EXISTS "board_automation" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"boardId" bigint NOT NULL,
	"fieldId" bigint NOT NULL,
	"optionId" bigint NOT NULL,
	"listId" bigint NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "board_automation_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "board_automation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_field_option" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"colourCode" varchar(12),
	"index" integer DEFAULT 0 NOT NULL,
	"fieldId" bigint NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "board_field_option_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "board_field_option" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_field" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"index" integer DEFAULT 0 NOT NULL,
	"boardId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	CONSTRAINT "board_field_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "board_field" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_field_value" (
	"cardId" bigint NOT NULL,
	"fieldId" bigint NOT NULL,
	"optionId" bigint NOT NULL,
	"updatedBy" uuid,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_field_value_cardId_fieldId_pk" PRIMARY KEY("cardId","fieldId")
);
--> statement-breakpoint
ALTER TABLE "card_field_value" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_fieldId_board_field_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."board_field"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_optionId_board_field_option_id_fk" FOREIGN KEY ("optionId") REFERENCES "public"."board_field_option"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_listId_list_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_field_option" ADD CONSTRAINT "board_field_option_fieldId_board_field_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."board_field"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_field" ADD CONSTRAINT "board_field_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_field" ADD CONSTRAINT "board_field_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_value" ADD CONSTRAINT "card_field_value_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_value" ADD CONSTRAINT "card_field_value_fieldId_board_field_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."board_field"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_value" ADD CONSTRAINT "card_field_value_optionId_board_field_option_id_fk" FOREIGN KEY ("optionId") REFERENCES "public"."board_field_option"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_value" ADD CONSTRAINT "card_field_value_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_automation_board_idx" ON "board_automation" USING btree ("boardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_field_option_field_idx" ON "board_field_option" USING btree ("fieldId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_field_board_idx" ON "board_field" USING btree ("boardId");