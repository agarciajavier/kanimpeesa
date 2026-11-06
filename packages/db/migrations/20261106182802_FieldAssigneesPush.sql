CREATE TABLE IF NOT EXISTS "card_field_assignee" (
	"cardId" bigint NOT NULL,
	"fieldId" bigint NOT NULL,
	"workspaceMemberId" bigint NOT NULL,
	"updatedBy" uuid,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_field_assignee_cardId_fieldId_pk" PRIMARY KEY("cardId","fieldId")
);
--> statement-breakpoint
ALTER TABLE "card_field_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" varchar(255) NOT NULL,
	"auth" varchar(255) NOT NULL,
	"userAgent" varchar(512),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_automation" ADD COLUMN "notifyFieldId" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_assignee" ADD CONSTRAINT "card_field_assignee_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_assignee" ADD CONSTRAINT "card_field_assignee_fieldId_board_field_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."board_field"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_assignee" ADD CONSTRAINT "card_field_assignee_workspaceMemberId_workspace_members_id_fk" FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_field_assignee" ADD CONSTRAINT "card_field_assignee_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_idx" ON "push_subscription" USING btree ("userId");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_notifyFieldId_board_field_id_fk" FOREIGN KEY ("notifyFieldId") REFERENCES "public"."board_field"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
