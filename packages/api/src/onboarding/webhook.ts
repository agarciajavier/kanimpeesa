import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { onboardingEmailEvents, onboardingEmails } from "@kan/db/schema";

import { alertEmail } from "./config";
import { describeError } from "./errors";
import { resendSend } from "./resend";
import { escapeHtml } from "./templates";

// Impeesa onboarding: Resend's notices about each email (delivered, opened,
// bounced...). Resend signs them (Svix): nothing is believed without a valid
// signature made with RESEND_WEBHOOK_SECRET. Notices can arrive twice or out
// of order: each one is kept once, and an email's status only moves forward.
//
// The webhook is for the whole Resend account, so it also brings notices of
// emails that aren't from the onboarding (Azimut, the panel): those are
// ignored and nothing about them is kept.

const TOLERANCE_SECONDS = 5 * 60;

export function verifyResendSignature(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (
    !Number.isFinite(seconds) ||
    Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS
  )
    return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();
  // "v1,<firma> v1,<firma>": any one that matches is enough.
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// How far along an email is. A notice never moves it back (an "entregado"
// arriving after the "abierto" doesn't undo it). Bounced, spam and failed
// are the end.
const RANK: Record<string, number> = {
  sending: 0,
  accepted: 1,
  delayed: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 9,
  complained: 9,
  failed: 9,
};

const STATUS_BY_TYPE: Record<string, string> = {
  "email.delivery_delayed": "delayed",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string };
}

export async function recordResendEvent(
  db: dbClient,
  eventId: string,
  event: ResendEvent,
): Promise<"ignored" | "duplicate" | "recorded"> {
  const resendId = event.data?.email_id;
  const status = event.type ? STATUS_BY_TYPE[event.type] : undefined;
  if (!resendId || !status || !event.type) return "ignored";

  const email = await db.query.onboardingEmails.findFirst({
    where: eq(onboardingEmails.resendId, resendId),
  });
  if (!email) return "ignored";

  const parsed = event.created_at ? new Date(event.created_at) : new Date();
  const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const [inserted] = await db
    .insert(onboardingEmailEvents)
    .values({ eventId, resendId, type: event.type, occurredAt: at })
    .onConflictDoNothing()
    .returning({ id: onboardingEmailEvents.id });
  if (!inserted) return "duplicate";

  const forward = (RANK[status] ?? 0) > (RANK[email.status] ?? 0);
  await db
    .update(onboardingEmails)
    .set({
      ...(forward && { status }),
      ...(status === "delivered" && !email.deliveredAt && { deliveredAt: at }),
      // A click means it was opened, even if the open wasn't detected.
      ...((status === "opened" || status === "clicked") &&
        !email.openedAt && { openedAt: at }),
      ...(status === "bounced" && !email.bouncedAt && { bouncedAt: at }),
      lastEventAt:
        email.lastEventAt && email.lastEventAt > at ? email.lastEventAt : at,
    })
    .where(eq(onboardingEmails.id, email.id));

  // The client didn't get it: Ángel finds out right away, once.
  if (
    forward &&
    (status === "bounced" || status === "complained" || status === "failed")
  )
    await alertNotReceived(email, status);
  return "recorded";
}

const NOT_RECEIVED: Record<string, string> = {
  bounced: "rebotó (la dirección no lo recibió)",
  complained: "fue marcado como spam",
  failed: "no se pudo entregar",
};

async function alertNotReceived(
  email: { id: number; kind: string; toEmail: string; subject: string },
  status: string,
) {
  try {
    await resendSend({
      to: alertEmail(),
      subject: `[Panel · Onboarding] Un correo ${NOT_RECEIVED[status]}`,
      html: `<p>El correo <strong>${escapeHtml(email.subject)}</strong> a <strong>${escapeHtml(email.toEmail)}</strong> ${NOT_RECEIVED[status]}.</p>
<p>Revisá la dirección con el cliente. El estado se ve en la sección Forms del panel.</p>`,
      idempotencyKey: `onb-email-${email.id}-${status}`,
    });
  } catch (error) {
    console.error(
      "[onboarding] no se pudo avisar del correo no recibido",
      describeError(error),
    );
  }
}
