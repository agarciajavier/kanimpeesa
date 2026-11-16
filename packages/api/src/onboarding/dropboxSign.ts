import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { onboardingClients, onboardingSubmissions } from "@kan/db/schema";

import { tycFieldJob } from "./handlers";
import { enqueueJob } from "./queue";

// Impeesa onboarding: Dropbox Sign's notices about the terms and conditions.
// Ángel prepares and sends them himself (Dropbox Sign's Google Docs add-on);
// the panel only follows along and moves "Términos y condiciones" on the
// client's card. Nothing is sent from here.
//
// The client is found by the email of a signer who isn't from Impeesa:
// the address given in "Nuevo cliente" or the contact email of the initial
// form. Requests that match no onboarding client (clients from the old flow,
// other documents) are ignored.

const OWN_DOMAIN = "@impeesamarketing.com";

export interface SignEvent {
  event?: {
    event_type?: string;
    event_time?: string;
    event_hash?: string;
  };
  signature_request?: {
    signature_request_id?: string;
    title?: string;
    is_complete?: boolean;
    signatures?: {
      signer_email_address?: string;
      status_code?: string;
    }[];
  };
}

// event_hash = HMAC-SHA256(API key, event_time + event_type), in hex.
export function verifyDropboxSignEvent(event: SignEvent, apiKey: string) {
  const { event_type, event_time, event_hash } = event.event ?? {};
  if (!event_type || !event_time || !event_hash) return false;
  const expected = createHmac("sha256", apiKey)
    .update(`${event_time}${event_type}`)
    .digest("hex");
  return (
    event_hash.length === expected.length &&
    timingSafeEqual(Buffer.from(event_hash), Buffer.from(expected))
  );
}

// Notices that say where the request stands. Declined, canceled or failed
// requests don't move the card (Ángel sees them in Dropbox Sign).
const FOLLOWED = new Set([
  "signature_request_sent",
  "signature_request_viewed",
  "signature_request_signed",
  "signature_request_all_signed",
  "signature_request_downloadable",
  "signature_request_remind",
]);

const isOwn = (email: string) => email.endsWith(OWN_DOMAIN);

// Where the card should be, from who has signed.
export function tycOption(event: SignEvent): string | null {
  const type = event.event?.event_type;
  if (!type || !FOLLOWED.has(type)) return null;
  const request = event.signature_request;
  const signatures = request?.signatures ?? [];
  const signed = (s: { status_code?: string }) => s.status_code === "signed";

  if (
    type === "signature_request_all_signed" ||
    request?.is_complete ||
    (signatures.length > 0 && signatures.every(signed))
  )
    return "Firmados por todos";

  const email = (s: { signer_email_address?: string }) =>
    (s.signer_email_address ?? "").toLowerCase();
  const ownSigned = signatures.some((s) => isOwn(email(s)) && signed(s));
  const clientPending = signatures.some((s) => !isOwn(email(s)) && !signed(s));
  if (ownSigned && clientPending) return "Pendiente firma del cliente";
  return "Enviados para firmar";
}

export function clientSignerEmails(event: SignEvent) {
  return [
    ...new Set(
      (event.signature_request?.signatures ?? [])
        .map((s) => (s.signer_email_address ?? "").trim().toLowerCase())
        .filter((e) => e.includes("@") && !isOwn(e)),
    ),
  ];
}

export async function recordSignEvent(
  db: dbClient,
  event: SignEvent,
): Promise<{ outcome: "ignored" | "no_client" | "recorded"; option?: string }> {
  const option = tycOption(event);
  if (!option) return { outcome: "ignored" };
  const emails = clientSignerEmails(event);
  if (!emails.length) return { outcome: "no_client" };

  // By the "Nuevo cliente" address or the initial form's contact email.
  // If several match, the most recent one.
  const contactEmail = sql<string>`lower(${onboardingSubmissions.answers}->>'correoContacto')`;
  const byContact = db
    .select({ id: onboardingSubmissions.onboardingClientId })
    .from(onboardingSubmissions)
    .where(
      and(
        eq(onboardingSubmissions.form, "administrativa"),
        inArray(contactEmail, emails),
      ),
    );
  const [client] = await db
    .select({ id: onboardingClients.id })
    .from(onboardingClients)
    .where(
      and(
        isNull(onboardingClients.deletedAt),
        or(
          inArray(sql`lower(${onboardingClients.email})`, emails),
          inArray(onboardingClients.id, byContact),
        ),
      ),
    )
    .orderBy(desc(onboardingClients.createdAt))
    .limit(1);
  if (!client) return { outcome: "no_client", option };

  // Once per client and step; the job only moves the card forward.
  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: tycFieldJob(option),
  });
  return { outcome: "recorded", option };
}
