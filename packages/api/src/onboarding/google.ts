import { createSign } from "node:crypto";

import { GOOGLE_SUBJECT } from "./config";
import { PermanentError, RetryableError } from "./errors";

// Impeesa onboarding: Google APIs as administracion@, through the service
// account with domain-wide delegation. The key is the Railway variable
// GOOGLE_SERVICE_ACCOUNT_JSON_B64 and is never logged.

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
].join(" ");

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!encoded)
    throw new PermanentError(
      "Falta GOOGLE_SERVICE_ACCOUNT_JSON_B64 en Railway",
    );
  return JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8"),
  ) as ServiceAccount;
}

const b64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
    return cachedToken.value;

  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: account.client_email,
      sub: GOOGLE_SUBJECT,
      scope: SCOPES,
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(account.private_key, "base64url");

  let response: Response;
  try {
    response = await fetch(account.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });
  } catch (error) {
    throw new RetryableError(
      `Google no respondió al pedir acceso: ${String(error)}`,
    );
  }

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    const message = `Google rechazó el acceso de la cuenta de servicio (${response.status} ${body.error ?? ""})`;
    if (response.status >= 500) throw new RetryableError(message);
    throw new PermanentError(message);
  }

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }

  get isTemporary() {
    return (
      this.status === 429 ||
      this.status >= 500 ||
      [
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "sharingRateLimitExceeded",
        "backendError",
      ].includes(this.reason)
    );
  }
}

// Calls a Google API and returns its JSON. Network failures are temporary;
// HTTP errors come back as GoogleApiError so each caller can tell them apart.
export async function googleApi<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined && {
          "Content-Type": "application/json",
        }),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new RetryableError(`Google no respondió: ${String(error)}`);
  }

  if (response.status === 401) cachedToken = null;

  const text = await response.text();
  if (!response.ok) {
    let reason = "";
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as {
        error?: {
          message?: string;
          status?: string;
          errors?: { reason?: string }[];
        };
      };
      reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? "";
      message = parsed.error?.message ?? message;
    } catch {
      // Not JSON: keep the raw start of the body.
    }
    throw new GoogleApiError(
      response.status,
      reason,
      `Google ${response.status} ${reason}: ${message}`,
    );
  }

  return (text ? JSON.parse(text) : {}) as T;
}

// Turns a Google error into what the queue understands, for callers that
// don't need to tell errors apart.
export function asJobError(error: unknown): Error {
  if (error instanceof GoogleApiError)
    return error.isTemporary
      ? new RetryableError(error.message)
      : new PermanentError(error.message);
  return error instanceof Error ? error : new Error(String(error));
}

// Uploads a file (bytes) to a Drive folder and returns its id. Same error
// handling as googleApi.
export async function googleUpload(
  folderId: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ id: string }> {
  const token = await accessToken();
  const boundary = `impeesa${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, mimeType, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  let response: Response;
  try {
    response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch (error) {
    throw new RetryableError(`Google no respondió: ${String(error)}`);
  }
  if (response.status === 401) cachedToken = null;
  const text = await response.text();
  if (!response.ok)
    throw new GoogleApiError(
      response.status,
      "",
      `Google ${response.status}: ${text.slice(0, 300)}`,
    );
  return JSON.parse(text) as { id: string };
}
