import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { clientStatuses } from "@kan/shared/constants";

import { cards } from "./cards";
import { users } from "./users";
import { workspaces } from "./workspaces";

// Impeesa: clients are shared by every board in a workspace, unlike labels,
// which belong to a single board. A card has at most one client.
// colourCode always follows status (see clientStatusDetails).
export const clientStatusEnum = pgEnum("client_status", clientStatuses);

export const clients = pgTable(
  "client",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    colourCode: varchar("colourCode", { length: 12 }),
    status: clientStatusEnum("status").notNull().default("starting"),
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
