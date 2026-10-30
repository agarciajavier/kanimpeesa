ALTER TABLE "board_automation" ALTER COLUMN "listId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "board_automation" ADD COLUMN "setFieldId" bigint;--> statement-breakpoint
ALTER TABLE "board_automation" ADD COLUMN "setOptionId" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_setFieldId_board_field_id_fk" FOREIGN KEY ("setFieldId") REFERENCES "public"."board_field"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_automation" ADD CONSTRAINT "board_automation_setOptionId_board_field_option_id_fk" FOREIGN KEY ("setOptionId") REFERENCES "public"."board_field_option"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
