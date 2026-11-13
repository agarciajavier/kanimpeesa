import {
  ONBOARDING_TEMPLATE_CELL,
  REAL_SHEET_ID,
  TEMPLATE_TAB,
  WELCOME_TEMPLATE_CELL,
} from "./config";
import { PermanentError } from "./errors";
import { asJobError, googleApi } from "./google";

// Impeesa onboarding: the email templates are the notes of cells D5
// (welcome) and D6 (second email) of "Control automatización" in the billing
// Sheet. They are read fresh before every email, so a change in the note
// applies to the next send. Nothing in the text is rewritten: only the
// {{MARKERS}} are replaced.

export interface Template {
  subject: string;
  html: string;
  // Only in D6: the four approved sentences about access to the folder.
  accessVariants: Partial<Record<AccessStatus, string>>;
}

export type AccessStatus =
  | "edicion"
  | "lectura"
  | "invalida"
  | "no_verificable";

const VARIANT_PREFIXES: [AccessStatus, string][] = [
  ["edicion", "Edición confirmada:"],
  ["lectura", "Solo lectura por enlace"],
  ["invalida", "Dirección no válida"],
  ["no_verificable", "Acceso no verificable"],
];

async function readNote(cell: string): Promise<string> {
  const range = encodeURIComponent(`'${TEMPLATE_TAB}'!${cell}`);
  try {
    const data = await googleApi<{
      sheets?: { data?: { rowData?: { values?: { note?: string }[] }[] }[] }[];
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${REAL_SHEET_ID}?ranges=${range}&fields=sheets.data.rowData.values.note`,
    );
    const note = data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.note;
    if (!note)
      throw new PermanentError(
        `La nota de la celda ${cell} ("${TEMPLATE_TAB}") está vacía o no existe`,
      );
    return note.replace(/\r\n/g, "\n");
  } catch (error) {
    throw asJobError(error);
  }
}

function parse(note: string, cell: string): Template {
  const subjectMatch = /^ASUNTO:\s*(.+)$/m.exec(note);
  const bodyIndex = note.search(/^CUERPO HTML:\s*$/m);
  if (!subjectMatch?.[1] || bodyIndex < 0)
    throw new PermanentError(
      `No encuentro "ASUNTO:" o "CUERPO HTML:" en la nota de ${cell}`,
    );

  const html = note
    .slice(bodyIndex)
    .replace(/^CUERPO HTML:\s*\n/, "")
    .trim();

  const accessVariants: Template["accessVariants"] = {};
  const variantsStart = note.indexOf("VARIANTES DE ACCESO:");
  if (variantsStart >= 0) {
    const lines = note
      .slice(variantsStart, note.indexOf("ASUNTO:"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));
    for (const line of lines) {
      const text = line.slice(2);
      const match = VARIANT_PREFIXES.find(([, prefix]) =>
        text.startsWith(prefix),
      );
      const colon = text.indexOf(":");
      if (match && colon >= 0)
        accessVariants[match[0]] = text.slice(colon + 1).trim();
    }
  }

  return { subject: subjectMatch[1].trim(), html, accessVariants };
}

export async function readWelcomeTemplate() {
  return parse(await readNote(WELCOME_TEMPLATE_CELL), WELCOME_TEMPLATE_CELL);
}

export async function readOnboardingTemplate() {
  const template = parse(
    await readNote(ONBOARDING_TEMPLATE_CELL),
    ONBOARDING_TEMPLATE_CELL,
  );
  for (const [status] of VARIANT_PREFIXES)
    if (!template.accessVariants[status])
      throw new PermanentError(
        `Falta la variante de acceso "${status}" en la nota de ${ONBOARDING_TEMPLATE_CELL}`,
      );
  return template;
}

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Replaces {{MARKERS}}. Values are client data: escaped in the body, and
// stripped of line breaks in the subject. Every value must be present and
// no marker may be left, or nothing is sent.
export function fill(
  template: { subject: string; html: string },
  values: Record<string, string | null | undefined>,
  { rawHtml = {} }: { rawHtml?: Record<string, string> } = {},
) {
  for (const [key, value] of Object.entries(values))
    if (!value?.trim())
      throw new PermanentError(`Falta el dato {{${key}}} para armar el correo`);

  const replace = (text: string, forHtml: boolean) =>
    text.replace(/\{\{([A-Z_]+)\}\}/g, (marker, key: string) => {
      if (forHtml && key in rawHtml) return rawHtml[key] ?? marker;
      const value = values[key];
      if (value == null) return marker;
      return forHtml
        ? escapeHtml(value.trim())
        : value.trim().replace(/[\r\n]+/g, " ");
    });

  const subject = replace(template.subject, false);
  const html = replace(template.html, true);
  const left = /\{\{[A-Z_]+\}\}/.exec(`${subject}\n${html}`);
  if (left)
    throw new PermanentError(
      `La plantilla tiene el marcador ${left[0]} y no hay dato para él`,
    );
  return { subject, html };
}
