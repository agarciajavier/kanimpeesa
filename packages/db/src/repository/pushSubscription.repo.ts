import { and, eq, inArray } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { pushSubscriptions } from "@kan/db/schema";

// Impeesa: devices where a user turned on push notifications.

export const upsert = async (
  db: dbClient,
  input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  },
) => {
  // A device belongs to whoever subscribed it last.
  await db
    .insert(pushSubscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      },
    });
};

export const removeForUser = (
  db: dbClient,
  input: { userId: string; endpoint: string },
) => {
  return db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    );
};

export const isSubscribed = async (
  db: dbClient,
  input: { userId: string; endpoint: string },
) => {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    )
    .limit(1);
  return !!row;
};

export const getByUserIds = async (db: dbClient, userIds: string[]) => {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
};

export const removeByIds = async (db: dbClient, ids: number[]) => {
  if (ids.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids));
};
