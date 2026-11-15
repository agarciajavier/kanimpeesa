CREATE TABLE IF NOT EXISTS "onboarding_draft" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"onboardingClientId" bigint NOT NULL,
	"form" varchar(32) NOT NULL,
	"formVersion" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_draft" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_draft" ADD CONSTRAINT "onboarding_draft_onboardingClientId_onboarding_client_id_fk" FOREIGN KEY ("onboardingClientId") REFERENCES "public"."onboarding_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_draft_client_form_unique" ON "onboarding_draft" USING btree ("onboardingClientId","form");