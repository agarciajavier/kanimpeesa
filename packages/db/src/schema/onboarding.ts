import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cards } from "./cards";
import { clients } from "./clients";
import { users } from "./users";
import { workspaces } from "./workspaces";

// Impeesa: client onboarding (the "Forms" section). Replaces Microsoft Forms
// + Make: a client is registered with "Nuevo cliente", gets a welcome email
// with a personal link to the administrative form, and submitting it starts
// a chain of jobs (Sheet row, Drive folder, sharing, second email...).
//
// Every side effect runs as a row of onboarding_job, so nothing depends on
// the web process staying up: a job that fails is retried later, and a job
// that already ran is never run twice (see dedupKey).

export const onboardingClients = pgTable(
  "onboarding_client",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    // Secret part of the client's form link (/f/<token>). Long and random,
    // so it can't be guessed.
    token: varchar("token", { length: 64 }).notNull().unique(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // What "Nuevo cliente" asked for: the first name used in the emails and
    // the address the welcome email goes to.
    firstName: varchar("firstName", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    // Test clients send every email to the test inbox and write to the test
    // Sheet and folder, never to the real ones.
    isTest: boolean("isTest").notNull().default(true),
    // The card on the Onboarding board and, once known, the panel client.
    cardId: bigint("cardId", { mode: "number" }).references(() => cards.id, {
      onDelete: "set null",
    }),
    clientId: bigint("clientId", { mode: "number" }).references(
      () => clients.id,
      { onDelete: "set null" },
    ),
    // CLI-XXX, given when the row is written to the Sheet.
    cliCode: varchar("cliCode", { length: 16 }),
    // The client's Drive folder, once created.
    driveFolderId: varchar("driveFolderId", { length: 128 }),
    driveFolderUrl: varchar("driveFolderUrl", { length: 2048 }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [
    index("onboarding_client_workspace_idx").on(table.workspaceId),
    uniqueIndex("onboarding_client_cli_unique").on(table.cliCode),
  ],
).enableRLS();

// A form answered by a client. One per form and client: a second submit of
// the same form is refused, so the chain never runs twice.
export const onboardingSubmissions = pgTable(
  "onboarding_submission",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    onboardingClientId: bigint("onboardingClientId", { mode: "number" })
      .notNull()
      .references(() => onboardingClients.id, { onDelete: "cascade" }),
    // "administrativa" or "estrategica".
    form: varchar("form", { length: 32 }).notNull(),
    formVersion: integer("formVersion").notNull(),
    answers: jsonb("answers").notNull(),
    submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("onboarding_submission_client_form_unique").on(
      table.onboardingClientId,
      table.form,
    ),
  ],
).enableRLS();

// The job queue. Also the record of every onboarding stage: its status,
// when it happened and what it produced (result).
//   pending   → waiting for its turn (or for nextRunAt after a failure)
//   running   → a process took it (lockedUntil says until when)
//   done      → finished; result holds the reference (row, folder, email id)
//   failed    → gave up after the last attempt; needs a manual retry
//   uncertain → it may or may not have happened (e.g. the email provider
//               didn't answer): never retried blindly, someone must check
export const onboardingJobs = pgTable(
  "onboarding_job",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    onboardingClientId: bigint("onboardingClientId", { mode: "number" })
      .notNull()
      .references(() => onboardingClients.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 64 }).notNull(),
    // Same key, same job: creating it again does nothing.
    dedupKey: varchar("dedupKey", { length: 255 }).notNull().unique(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(6),
    nextRunAt: timestamp("nextRunAt").defaultNow().notNull(),
    lockedUntil: timestamp("lockedUntil"),
    lockedBy: varchar("lockedBy", { length: 64 }),
    result: jsonb("result"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
    doneAt: timestamp("doneAt"),
  },
  (table) => [
    index("onboarding_job_client_idx").on(table.onboardingClientId),
    index("onboarding_job_due_idx").on(table.status, table.nextRunAt),
  ],
).enableRLS();

// Every email sent through Resend, with what Resend later told us about it.
// status: accepted → delivered → opened, or bounced / failed. Opening is
// informative only; nothing waits for it.
export const onboardingEmails = pgTable(
  "onboarding_email",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    onboardingClientId: bigint("onboardingClientId", { mode: "number" })
      .notNull()
      .references(() => onboardingClients.id, { onDelete: "cascade" }),
    // "bienvenida", "onboarding"...
    kind: varchar("kind", { length: 32 }).notNull(),
    toEmail: varchar("toEmail", { length: 320 }).notNull(),
    subject: text("subject").notNull(),
    resendId: varchar("resendId", { length: 64 }).unique(),
    status: varchar("status", { length: 16 }).notNull().default("accepted"),
    deliveredAt: timestamp("deliveredAt"),
    openedAt: timestamp("openedAt"),
    bouncedAt: timestamp("bouncedAt"),
    lastEventAt: timestamp("lastEventAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("onboarding_email_client_idx").on(table.onboardingClientId),
    // One email per stage and client.
    uniqueIndex("onboarding_email_client_kind_unique").on(
      table.onboardingClientId,
      table.kind,
    ),
  ],
).enableRLS();

// Resend's webhook notices, kept once each (they can arrive twice or out of
// order).
export const onboardingEmailEvents = pgTable(
  "onboarding_email_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Resend's own id for the notice (svix-id header).
    eventId: varchar("eventId", { length: 128 }).notNull().unique(),
    resendId: varchar("resendId", { length: 64 }),
    type: varchar("type", { length: 64 }).notNull(),
    occurredAt: timestamp("occurredAt"),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  },
  (table) => [index("onboarding_email_event_resend_idx").on(table.resendId)],
).enableRLS();
