import type { NextApiRequest, NextApiResponse } from "next";
import type { Readable } from "node:stream";

import {
  recordResendEvent,
  verifyResendSignature,
} from "@kan/api/onboarding/webhook";
import { createDrizzleClient } from "@kan/db/client";

// Impeesa: Resend's notices about the onboarding emails (delivered, opened,
// bounced...). The body is read raw: the signature is over the exact bytes.
export const config = { api: { bodyParser: false } };

const db = createDrizzleClient();

async function readBody(readable: Readable) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of readable) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 256 * 1024) throw new Error("too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const header = (req: NextApiRequest, name: string) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[onboarding] falta RESEND_WEBHOOK_SECRET");
    // Resend keeps the notice and retries later.
    return res.status(503).json({ message: "Not configured" });
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    return res.status(413).json({ message: "Too large" });
  }

  const signed = {
    id: header(req, "svix-id"),
    timestamp: header(req, "svix-timestamp"),
    signature: header(req, "svix-signature"),
  };
  if (!verifyResendSignature(rawBody, signed, secret))
    return res.status(401).json({ message: "Invalid signature" });

  let event: Parameters<typeof recordResendEvent>[2];
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return res.status(400).json({ message: "Invalid JSON" });
  }

  try {
    const outcome = await recordResendEvent(db, signed.id ?? "", event);
    return res.status(200).json({ outcome });
  } catch (error) {
    console.error("[onboarding] no se pudo guardar el aviso de Resend", error);
    // 500: Resend tries again later.
    return res.status(500).json({ message: "Error" });
  }
}
