import { REPLY_TO, SENDER } from "./config";
import { PermanentError, RetryableError } from "./errors";

// Impeesa onboarding: emails through Resend's API, with the key
// RESEND_ONBOARDING_API_KEY (sending only). The Idempotency-Key makes Resend
// return the first result instead of sending again if the same email is
// asked for twice within 24 hours.

export async function resendSend({
  to,
  subject,
  html,
  idempotencyKey,
}: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  const key = process.env.RESEND_ONBOARDING_API_KEY;
  if (!key)
    throw new PermanentError("Falta RESEND_ONBOARDING_API_KEY en Railway");

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: SENDER,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    // The request may have reached Resend: retrying with the same key is
    // safe within 24 hours (see sendTracked).
    throw new RetryableError(`Resend no respondió: ${String(error)}`);
  }

  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (response.ok && body.id) return { id: body.id };

  const message = `Resend ${response.status} ${body.name ?? ""}: ${body.message ?? ""}`;
  // 409: the same key is still being processed. 429: too many at once.
  if (
    response.status === 409 ||
    response.status === 429 ||
    response.status >= 500
  )
    throw new RetryableError(message);
  throw new PermanentError(message);
}
