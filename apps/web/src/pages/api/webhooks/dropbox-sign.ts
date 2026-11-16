import type { NextApiRequest, NextApiResponse } from "next";
import type { Readable } from "node:stream";

import type { SignEvent } from "@kan/api/onboarding/dropboxSign";
import {
  recordSignEvent,
  verifyDropboxSignEvent,
} from "@kan/api/onboarding/dropboxSign";
import { createDrizzleClient } from "@kan/db/client";

// Impeesa: Dropbox Sign's account callback (terms and conditions). Ángel
// sends the terms himself; these notices move "Términos y condiciones" on
// the client's card. Nothing is sent from here.
//
// Dropbox Sign sends a form with a "json" field and expects exactly "Hello
// API Event Received" back; anything else (or an error) and it tries again
// later. Each notice is checked with DROPBOX_SIGN_API_KEY.
export const config = { api: { bodyParser: false } };

const ACK = "Hello API Event Received";

const db = createDrizzleClient();

async function readBody(readable: Readable) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of readable) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) {
    console.error("[dropbox-sign] falta DROPBOX_SIGN_API_KEY");
    return res.status(503).send("Not configured");
  }

  let event: SignEvent;
  try {
    const raw = await readBody(req);
    const type = req.headers["content-type"] ?? "";
    let json: string | null;
    if (type.includes("multipart/form-data") || type.includes("urlencoded")) {
      const form = await new Response(raw, {
        headers: { "content-type": type },
      }).formData();
      const field = form.get("json");
      json = typeof field === "string" ? field : null;
    } else json = raw.toString("utf8");
    if (!json) return res.status(400).send("Missing json");
    event = JSON.parse(json) as SignEvent;
  } catch {
    return res.status(400).send("Invalid body");
  }

  if (!verifyDropboxSignEvent(event, apiKey))
    return res.status(401).send("Invalid event hash");

  try {
    const { outcome, option } = await recordSignEvent(db, event);
    // No names or emails in the log.
    console.log(
      "[dropbox-sign] aviso",
      JSON.stringify({
        type: event.event?.event_type,
        requestId: event.signature_request?.signature_request_id,
        outcome,
        option,
      }),
    );
  } catch (error) {
    console.error("[dropbox-sign] no se pudo procesar el aviso", error);
    // Not the ACK: Dropbox Sign tries again later.
    return res.status(500).send("Error");
  }

  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send(ACK);
}
