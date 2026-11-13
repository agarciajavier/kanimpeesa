CREATE TABLE IF NOT EXISTS "onboarding_client" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"token" varchar(64) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"firstName" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"isTest" boolean DEFAULT true NOT NULL,
	"cardId" bigint,
	"clientId" bigint,
	"cliCode" varchar(16),
	"driveFolderId" varchar(128),
	"driveFolderUrl" varchar(2048),
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	CONSTRAINT "onboarding_client_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "onboarding_client_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "onboarding_client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_email_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"eventId" varchar(128) NOT NULL,
	"resendId" varchar(64),
	"type" varchar(64) NOT NULL,
	"occurredAt" timestamp,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_email_event_eventId_unique" UNIQUE("eventId")
);
--> statement-breakpoint
ALTER TABLE "onboarding_email_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_email" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"onboardingClientId" bigint NOT NULL,
	"kind" varchar(32) NOT NULL,
	"toEmail" varchar(320) NOT NULL,
	"subject" text NOT NULL,
	"resendId" varchar(64),
	"status" varchar(16) DEFAULT 'accepted' NOT NULL,
	"deliveredAt" timestamp,
	"openedAt" timestamp,
	"bouncedAt" timestamp,
	"lastEventAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_email_resendId_unique" UNIQUE("resendId")
);
--> statement-breakpoint
ALTER TABLE "onboarding_email" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"onboardingClientId" bigint NOT NULL,
	"kind" varchar(64) NOT NULL,
	"dedupKey" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 6 NOT NULL,
	"nextRunAt" timestamp DEFAULT now() NOT NULL,
	"lockedUntil" timestamp,
	"lockedBy" varchar(64),
	"result" jsonb,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"doneAt" timestamp,
	CONSTRAINT "onboarding_job_dedupKey_unique" UNIQUE("dedupKey")
);
--> statement-breakpoint
ALTER TABLE "onboarding_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_submission" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"onboardingClientId" bigint NOT NULL,
	"form" varchar(32) NOT NULL,
	"formVersion" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"submittedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_submission_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "onboarding_submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_client" ADD CONSTRAINT "onboarding_client_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_client" ADD CONSTRAINT "onboarding_client_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_client" ADD CONSTRAINT "onboarding_client_clientId_client_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_client" ADD CONSTRAINT "onboarding_client_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_email" ADD CONSTRAINT "onboarding_email_onboardingClientId_onboarding_client_id_fk" FOREIGN KEY ("onboardingClientId") REFERENCES "public"."onboarding_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_job" ADD CONSTRAINT "onboarding_job_onboardingClientId_onboarding_client_id_fk" FOREIGN KEY ("onboardingClientId") REFERENCES "public"."onboarding_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_submission" ADD CONSTRAINT "onboarding_submission_onboardingClientId_onboarding_client_id_fk" FOREIGN KEY ("onboardingClientId") REFERENCES "public"."onboarding_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_client_workspace_idx" ON "onboarding_client" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_client_cli_unique" ON "onboarding_client" USING btree ("cliCode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_email_event_resend_idx" ON "onboarding_email_event" USING btree ("resendId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_email_client_idx" ON "onboarding_email" USING btree ("onboardingClientId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_email_client_kind_unique" ON "onboarding_email" USING btree ("onboardingClientId","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_job_client_idx" ON "onboarding_job" USING btree ("onboardingClientId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_job_due_idx" ON "onboarding_job" USING btree ("status","nextRunAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_submission_client_form_unique" ON "onboarding_submission" USING btree ("onboardingClientId","form");