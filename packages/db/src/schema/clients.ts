import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { clientStatuses, clientTypes } from "@kan/shared/constants";

import { cards } from "./cards";
import { users } from "./users";
import { workspaces } from "./workspaces";

// Impeesa: clients are shared by every board in a workspace, unlike labels,
// which belong to a single board. A card has at most one client.
// colourCode always follows status (see clientStatusDetails).
export const clientStatusEnum = pgEnum("client_status", clientStatuses);
// Gestión or Asesoría; empty until someone sets it.
export const clientTypeEnum = pgEnum("client_type", clientTypes);

export const clients = pgTable(
  "client",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    colourCode: varchar("colourCode", { length: 12 }),
    status: clientStatusEnum("status").notNull().default("starting"),
    type: clientTypeEnum("type"),
    // The client's Google Drive folder, shown on every card of the client.
    driveUrl: varchar("driveUrl", { length: 2048 }),
    // A link to the client's brief (usually a Google Doc) and a short
    // free-text summary, both shown on the Clients page.
    briefUrl: varchar("briefUrl", { length: 2048 }),
    summary: text("summary"),
    // Profitability (Stats page, "finance:view" only): what the client pays
    // per month and what working on them costs per month (mostly what is
    // paid to freelancers), both in feeCurrency, plus the monthly hours
    // agreed with them. Hours actually worked come from time_entry.
    monthlyFee: numeric("monthlyFee", { precision: 14, scale: 2 }),
    monthlyCost: numeric("monthlyCost", { precision: 14, scale: 2 }),
    feeCurrency: varchar("feeCurrency", { length: 3 }).notNull().default("ARS"),
    contractedHours: numeric("contractedHours", { precision: 7, scale: 2 }),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
    deletedAt: timestamp("deletedAt"),
    deletedBy: uuid("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("client_workspace_idx").on(table.workspaceId)],
).enableRLS();

export const clientsRelations = relations(clients, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [clients.workspaceId],
    references: [workspaces.id],
    relationName: "clientsWorkspace",
  }),
  createdBy: one(users, {
    fields: [clients.createdBy],
    references: [users.id],
    relationName: "clientsCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [clients.deletedBy],
    references: [users.id],
    relationName: "clientsDeletedByUser",
  }),
  cards: many(cards, { relationName: "cardsClient" }),
}));
