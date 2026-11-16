import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Readable } from "node:stream";

// Impeesa: Dropbox Sign's account callback (signed terms and conditions).
//
// FIRST STEP, TEST ONLY: it just writes to the log which notices arrive, to
// find out whether requests sent from the Google Docs add-on reach the
// account callback. It doesn't touch any client.
//
// Dropbox Sign sends a form with a "json" field and expects exactly "Hello
// API Event Received" back. Each notice carries event_hash =
// HMAC-SHA256(API key, event_time + event_type), checked with
// DROPBOX_SIGN_API_KEY.
export const config = { api: { bodyParser: false } };

const ACK = "Hello API Event Received";

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

interface SignEvent {
  event?: {
    event_type?: string;
    event_time?: string;
    event_hash?: string;
  };
  signature_request?: {
    signature_request_id?: string;
    title?: string;
    is_complete?: boolean;
    signatures?: { status_code?: string }[];
  };
}

function verifyDropboxSignEvent(event: SignEvent, apiKey: string) {
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

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

  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  const verified = apiKey ? verifyDropboxSignEvent(event, apiKey) : null;
  if (verified === false) return res.status(401).send("Invalid event hash");

  // Only what's needed to see what arrives: no names or emails.
  const request = event.signature_request;
  console.log(
    "[dropbox-sign] aviso",
    JSON.stringify({
      type: event.event?.event_type,
      time: event.event?.event_time,
      verified,
      requestId: request?.signature_request_id,
      title: request?.title,
      complete: request?.is_complete,
      signatures: request?.signatures?.map((s) => s.status_code),
    }),
  );

  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send(ACK);
}
