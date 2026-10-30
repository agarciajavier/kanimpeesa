ALTER TABLE "board_field_option" ADD COLUMN "isDone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "board_field" ADD COLUMN "isOptional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "board_field_option" SET "isDone" = true WHERE "name" IN ('Listo', 'Aprobado');--> statement-breakpoint
UPDATE "board_field" SET "isOptional" = true WHERE "name" = 'Modificaciones';
