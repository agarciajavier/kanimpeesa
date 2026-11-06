import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cards } from "./cards";
import { users } from "./users";

// Impeesa: links to files or folders (mostly Google Drive) on a card. Only
// the link is stored; nothing is copied from Drive.
export const cardLinks = pgTable(
  "card_link",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [index("card_link_card_idx").on(table.cardId)],
).enableRLS();

export const cardLinksRelations = relations(cardLinks, ({ one }) => ({
  card: one(cards, {
    fields: [cardLinks.cardId],
    references: [cards.id],
  }),
}));
