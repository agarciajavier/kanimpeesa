import webpush from "web-push";

import type { dbClient } from "@kan/db/client";
import * as pushSubscriptionRepo from "@kan/db/repository/pushSubscription.repo";
import { createLogger } from "@kan/logger";

// Impeesa: web push notifications (phone and computer, no app needed).
// Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; without them nothing is sent.

const log = createLogger("push");

export const getVapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let configured: boolean | null = null;

const configure = () => {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = !!publicKey && !!privateKey;
  if (configured)
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:angel@impeesamarketing.com",
      publicKey!,
      privateKey!,
    );
  return configured;
};

export interface PushMessage {
  title: string;
  body: string;
  // Page opened when the notification is tapped, e.g. /cards/abc123.
  url: string;
  // Notifications with the same tag replace each other on the device.
  tag?: string;
}

// Sends to every device of the users. Never throws: a failed notification
// must not undo the change that caused it.
export async function sendPush(
  db: dbClient,
  userIds: string[],
  message: PushMessage,
) {
  try {
    if (userIds.length === 0 || !configure()) return;

    const subscriptions = await pushSubscriptionRepo.getByUserIds(db, [
      ...new Set(userIds),
    ]);
    const payload = JSON.stringify(message);
    const gone: number[] = [];

    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 * 24 },
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // The device unsubscribed or the browser dropped it.
          if (status === 404 || status === 410) gone.push(s.id);
          else log.error({ err: error, status }, "Push send failed");
        }
      }),
    );

    await pushSubscriptionRepo.removeByIds(db, gone);
  } catch (error) {
    log.error({ err: error }, "Push notification failed");
  }
}
