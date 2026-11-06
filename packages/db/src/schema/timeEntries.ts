import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  pgEnum,
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

// Impeesa: time tracking. Each row is one stretch of work by one person on
// one card: started with the play button (source "timer") or typed in by
// hand afterwards (source "manual"). endedAt is null while the timer runs.
//
// clientId is the card's client WHEN the entry was saved, not a live link:
// if the card later changes client, past hours stay with the client they
// were worked for. workspaceId is copied too, so the stats (hours by person,
// by client, by month) are one query on this table without joining cards.
export const timeEntrySources = ["timer", "manual"] as const;
export type TimeEntrySource = (typeof timeEntrySources)[number];
export const timeEntrySourceEnum = pgEnum("time_entry_source", timeEntrySources);

export const timeEntries = pgTable(
  "time_entry",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Cards are soft-deleted, so the hours survive a deleted card.
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    clientId: bigint("clientId", { mode: "number" }).references(
      () => clients.id,
      { onDelete: "set null" },
    ),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: timeEntrySourceEnum("source").notNull().default("timer"),
    startedAt: timestamp("startedAt", { withTimezone: true }).notNull(),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [
    index("time_entry_workspace_started_idx").on(
      table.workspaceId,
      table.startedAt,
    ),
    index("time_entry_card_idx").on(table.cardId),
    index("time_entry_client_idx").on(table.clientId),
    index("time_entry_user_idx").on(table.userId),
    // A person has at most one timer running at a time.
    uniqueIndex("time_entry_one_running_per_user_idx")
      .on(table.userId)
      .where(sql`${table.endedAt} IS NULL AND ${table.deletedAt} IS NULL`),
  ],
).enableRLS();
