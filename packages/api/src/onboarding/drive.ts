import type { AccessStatus } from "./templates";
import { SUBFOLDERS } from "./config";
import { PermanentError, RetryableError } from "./errors";
import { asJobError, googleApi, GoogleApiError } from "./google";

// Impeesa onboarding: the client's Drive folder (named exactly as the
// business) with its four subfolders, and sharing it with the contact email.
// Folders are looked up before being created, so a retry never duplicates
// them. The folder is never made public.

const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export const folderUrl = (id: string) =>
  `https://drive.google.com/drive/folders/${id}`;

const quote = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

async function findOrCreateFolder(parentId: string, name: string) {
  const q = `${quote(parentId)} in parents and name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const found = await googleApi<{ files: { id: string }[] }>(
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&${ALL_DRIVES}`,
  );
  if (found.files.length > 1)
    throw new PermanentError(
      `Hay ${found.files.length} carpetas llamadas "${name}"; no elijo una sola por mi cuenta`,
    );
  if (found.files[0]) return { id: found.files[0].id, created: false };

  const created = await googleApi<{ id: string }>(
    `${DRIVE}/files?fields=id&supportsAllDrives=true`,
    {
      method: "POST",
      body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    },
  );
  return { id: created.id, created: true };
}

export async function prepareClientFolder(parentId: string, business: string) {
  const name = business.trim();
  if (!name) throw new PermanentError("Falta el nombre del negocio");
  try {
    const folder = await findOrCreateFolder(parentId, name);
    for (const sub of SUBFOLDERS) await findOrCreateFolder(folder.id, sub);
    return {
      id: folder.id,
      url: folderUrl(folder.id),
      created: folder.created,
    };
  } catch (error) {
    throw asJobError(error);
  }
}

interface Permission {
  type: string;
  role: string;
  emailAddress?: string;
}

async function permissions(folderId: string) {
  const data = await googleApi<{ permissions: Permission[] }>(
    `${DRIVE}/files/${folderId}/permissions?fields=permissions(type,role,emailAddress)&supportsAllDrives=true`,
  );
  return data.permissions;
}

const canEdit = (list: Permission[], email: string) =>
  list.some(
    (p) =>
      p.type === "user" &&
      p.emailAddress?.toLowerCase() === email.toLowerCase() &&
      ["writer", "organizer", "fileOrganizer", "owner"].includes(p.role),
  );

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ShareResult {
  access: AccessStatus;
  detail: string;
}

// Shares the folder for editing with the contact email and checks that
// Google really lists the permission. What it returns picks the sentence of
// the second email.
//   edicion        → verified editor
//   invalida       → Google refuses that address (no Google account...)
//   lectura        → couldn't give edit, but the folder is readable by link
//   no_verificable → anything else; temporary errors are retried first
export async function shareFolder(
  folderId: string,
  email: string,
  { notify, lastAttempt }: { notify: boolean; lastAttempt: boolean },
): Promise<ShareResult> {
  const address = email.trim();
  if (!EMAIL.test(address))
    return {
      access: "invalida",
      detail: "El correo no tiene un formato válido",
    };

  try {
    if (canEdit(await permissions(folderId), address))
      return { access: "edicion", detail: "Ya tenía permiso de edición" };

    await googleApi(
      `${DRIVE}/files/${folderId}/permissions?sendNotificationEmail=${notify}&supportsAllDrives=true&fields=id`,
      {
        method: "POST",
        body: { type: "user", role: "writer", emailAddress: address },
      },
    );

    if (canEdit(await permissions(folderId), address))
      return { access: "edicion", detail: "Permiso de edición verificado" };
    return fallback(
      folderId,
      "Google aceptó el pedido pero no lista el permiso",
    );
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw asJobError(error);

    // Google says the address can't receive the folder.
    if (
      error.status === 400 &&
      /invalidSharingRequest|invalid|google account/i.test(
        `${error.reason} ${error.message}`,
      )
    )
      return { access: "invalida", detail: error.message };

    if (error.isTemporary || error.status === 401) {
      if (!lastAttempt) throw new RetryableError(error.message);
      return fallback(folderId, error.message);
    }
    if (error.status === 404)
      throw new PermanentError(`La carpeta ya no existe: ${error.message}`);

    // Permission or policy problem on our side.
    return fallback(folderId, error.message);
  }
}

async function fallback(
  folderId: string,
  detail: string,
): Promise<ShareResult> {
  try {
    const list = await permissions(folderId);
    if (list.some((p) => p.type === "anyone" && p.role === "reader"))
      return { access: "lectura", detail };
  } catch {
    // Can't check: say it couldn't be verified.
  }
  return { access: "no_verificable", detail };
}
