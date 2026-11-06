import {
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

// Impeesa: browsers (phone or computer) where a user turned on push
// notifications. One row per device; a device that stops accepting pushes
// is removed when a send fails with 404/410.
export const pushSubscriptions = pgTable(
  "push_subscription",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    auth: varchar("auth", { length: 255 }).notNull(),
    userAgent: varchar("userAgent", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("push_subscription_user_idx").on(table.userId)],
).enableRLS();
