import { and, eq } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { onboardingEmails } from "@kan/db/schema";

import type { OnboardingTargets } from "./config";
import { PermanentError, RetryableError, UncertainError } from "./errors";
import { resendSend } from "./resend";

// Impeesa onboarding: one email per stage and client, never two.
//
// Before asking Resend, a row is saved for (client, kind); the unique index
// on that pair stops a second send. The Idempotency-Key is tied to that row,
// so if the answer from Resend is lost, asking again with the same key
// returns the first result instead of sending another email. Resend keeps
// keys 24 hours: past that, a row with no answer is "uncertain" and someone
// has to check the inbox before retrying.

const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

export async function sendTracked(
  db: dbClient,
  {
    client,
    kind,
    to,
    subject,
    html,
    targets,
  }: {
    client: { id: number; publicId: string };
    kind: string;
    to: string;
    subject: string;
    html: string;
    targets: OnboardingTargets;
  },
): Promise<{ resendId: string; alreadySent: boolean; sentTo: string }> {
  const sentTo = targets.redirectTo ?? to;
  const fullSubject = `${targets.subjectPrefix}${subject}`;

  const where = and(
    eq(onboardingEmails.onboardingClientId, client.id),
    eq(onboardingEmails.kind, kind),
  );
  let row = await db.query.onboardingEmails.findFirst({ where });

  if (row?.resendId)
    return { resendId: row.resendId, alreadySent: true, sentTo: row.toEmail };

  if (row?.status === "failed") {
    // Resend refused it before: it wasn't sent. Start over with a new key.
    await db.delete(onboardingEmails).where(eq(onboardingEmails.id, row.id));
    row = undefined;
  }

  if (row && Date.now() - row.createdAt.getTime() > IDEMPOTENCY_WINDOW_MS)
    throw new UncertainError(
      `No sé si el correo "${kind}" a ${row.toEmail} salió: Resend no confirmó y pasaron más de 24 h. Revisá en Resend antes de reintentar.`,
    );

  if (!row) {
    const [inserted] = await db
      .insert(onboardingEmails)
      .values({
        onboardingClientId: client.id,
        kind,
        toEmail: sentTo,
        subject: fullSubject,
        status: "sending",
      })
      .onConflictDoNothing()
      .returning();
    // Someone else saved it at the same moment: let the queue try later.
    if (!inserted)
      throw new RetryableError(
        `El correo "${kind}" se está enviando en otro proceso`,
      );
    row = inserted;
  }

  try {
    const { id } = await resendSend({
      to: sentTo,
      subject: fullSubject,
      html,
      idempotencyKey: `onb-${client.publicId}-${kind}-${row.id}`,
    });
    await db
      .update(onboardingEmails)
      .set({ resendId: id, status: "accepted" })
      .where(eq(onboardingEmails.id, row.id));
    return { resendId: id, alreadySent: false, sentTo };
  } catch (error) {
    if (error instanceof PermanentError)
      await db
        .update(onboardingEmails)
        .set({ status: "failed" })
        .where(eq(onboardingEmails.id, row.id));
    throw error;
  }
}
