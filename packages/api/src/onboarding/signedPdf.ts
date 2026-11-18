import { PermanentError, RetryableError } from "./errors";
import { asJobError, googleApi, googleUpload } from "./google";

// Impeesa onboarding: the signed terms and conditions, from Dropbox Sign to
// the client's Drive folder. Only reads from Dropbox Sign (it doesn't use
// the monthly sending quota). The file is looked up by name first, so a
// retry never uploads it twice.

const DRIVE = "https://www.googleapis.com/drive/v3";

export const signedPdfName = (business: string) =>
  `Términos y condiciones firmados - ${business.trim()}.pdf`;

const quote = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export async function downloadSignedPdf(requestId: string) {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey)
    throw new PermanentError("Falta DROPBOX_SIGN_API_KEY en Railway");
  if (!/^[a-f0-9]{20,64}$/i.test(requestId))
    throw new PermanentError("El aviso de Dropbox Sign trajo un id raro");

  let response: Response;
  try {
    response = await fetch(
      `https://api.hellosign.com/v3/signature_request/files/${requestId}?file_type=pdf`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch (error) {
    throw new RetryableError(`Dropbox Sign no respondió: ${String(error)}`);
  }
  // 409: the signed PDF is still being prepared.
  if (
    response.status === 409 ||
    response.status === 429 ||
    response.status >= 500
  )
    throw new RetryableError(
      `Dropbox Sign todavía no entrega el PDF (${response.status})`,
    );
  if (!response.ok)
    throw new PermanentError(
      `Dropbox Sign no dio el PDF firmado (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < 5 ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new RetryableError("Dropbox Sign devolvió algo que no es un PDF");
  return bytes;
}

export async function saveSignedPdf(
  folderId: string,
  business: string,
  requestId: string,
) {
  const name = signedPdfName(business);
  try {
    const found = await googleApi<{ files?: { id: string }[] }>(
      `${DRIVE}/files?q=${encodeURIComponent(
        `${quote(folderId)} in parents and name = ${quote(name)} and trashed = false`,
      )}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    );
    const existing = found.files?.[0];
    if (existing)
      return {
        fileId: existing.id,
        name,
        url: fileUrl(existing.id),
        already: true,
      };

    const bytes = await downloadSignedPdf(requestId);
    const { id } = await googleUpload(folderId, name, "application/pdf", bytes);
    return { fileId: id, name, url: fileUrl(id), already: false };
  } catch (error) {
    throw asJobError(error);
  }
}

export const fileUrl = (id: string) =>
  `https://drive.google.com/file/d/${id}/view`;
