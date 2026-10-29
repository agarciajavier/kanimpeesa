import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";
import { workspaces } from "./workspaces";

// Impeesa: reusable checklists, shared by every board in a workspace.
// A template is only a name plus its item titles; applying it copies them
// into a new checklist on the card, so editing a template later never
// touches checklists already created from it.
export const checklistTemplates = pgTable(
  "checklist_template",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    items: jsonb("items").$type<string[]>().notNull(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [index("checklist_template_workspace_idx").on(table.workspaceId)],
).enableRLS();

export const checklistTemplatesRelations = relations(
  checklistTemplates,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [checklistTemplates.workspaceId],
      references: [workspaces.id],
    }),
  }),
);
