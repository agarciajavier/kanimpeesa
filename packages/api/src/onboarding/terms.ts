import { SERVICES } from "./adminForm";
import { TERMS_TEMPLATES } from "./config";
import { PermanentError } from "./errors";
import { asJobError, googleApi } from "./google";

// Impeesa onboarding: the client's terms and conditions, as a Google Doc in
// the client's folder, made from a template (Ángel's own document with
// {{MARKERS}} where the data goes). The fixed text is never changed. Ángel
// reviews the document and sends it for signature himself (Dropbox Sign's
// Google Docs add-on); nothing is sent from here.

const DRIVE = "https://www.googleapis.com/drive/v3";
const DOCS = "https://docs.googleapis.com/v1/documents";

export type Service = (typeof SERVICES)[number];

export interface TermsInput {
  service: Service;
  razonSocial: string;
  cuit: string;
  nombreFantasia: string;
  // Whole pesos.
  honorario: number;
  // "noviembre de 2026"
  mesValores: string;
  // Only for management.
  incluyeDiseno: boolean;
  // Already written in contract style (empty: nothing is added).
  condicionesParticulares: string;
}

export const termsKind = (service: Service) =>
  service.startsWith("Asesoría") ? "asesoria" : "gestion";

const FREQUENCY: Partial<Record<Service, string>> = {
  "Asesoría - Plan Básico": "mensual",
  "Asesoría - Plan Medio": "quincenal",
  "Asesoría - Plan Full": "semanal",
};

const PLATFORMS: Partial<Record<Service, string>> = {
  "Administración y gestión de publicidad en RRSS": "Meta Ads",
  "Administración y gestión de publicidad integral": "Meta Ads y Google Ads",
};

// The texts approved by Ángel for clause 1.d (management) and the item in
// the service list. {{NOMBRE_FANTASIA}} is filled afterwards.
const DESIGN_ITEM =
  "Diseño de las piezas necesarias para la publicidad en base al material que el cliente proporcione.";
const DESIGN_YES =
  "La modalidad contratada por {{NOMBRE_FANTASIA}} incluye el diseño y la producción de las piezas gráficas y fotográficas necesarias para la publicidad, en base al material que EL CLIENTE proporcione. La producción y entrega de dichas piezas estará a cargo de EL PRESTADOR, quien las compartirá en la carpeta de Google Drive destinada a tal fin.";
const DESIGN_NO =
  "La modalidad contratada por {{NOMBRE_FANTASIA}} no incluye el diseño ni la producción de piezas gráficas, fotografías o material audiovisual. La producción y entrega de dichos materiales para las campañas estará a cargo de EL CLIENTE.";
const DESIGN_NO_EXCLUSION =
  "Esta exclusión no modifica las tareas de redacción de textos publicitarios o copys, creación, configuración y administración de campañas expresamente incluidas en EL SERVICIO. Cualquier incorporación posterior de diseño o producción de materiales requerirá un acuerdo expreso por escrito sobre su alcance y honorarios.";

export const termsName = (business: string) =>
  `Términos y condiciones - ${business.trim()}`;
export const termsUrl = (id: string) =>
  `https://docs.google.com/document/d/${id}/edit`;

// --- Amounts --------------------------------------------------------------

export const formatPesos = (n: number) =>
  n.toLocaleString("es-AR", { maximumFractionDigits: 0 });

const UNITS = [
  "",
  "UNO",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISÉIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
  "VEINTE",
  "VEINTIUNO",
  "VEINTIDÓS",
  "VEINTITRÉS",
  "VEINTICUATRO",
  "VEINTICINCO",
  "VEINTISÉIS",
  "VEINTISIETE",
  "VEINTIOCHO",
  "VEINTINUEVE",
];
const TENS = [
  "",
  "",
  "",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];
const HUNDREDS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

// 0-999. "apocope": UNO → UN before MIL / MILLÓN(ES).
function belowThousand(n: number, apocope: boolean): string {
  if (n === 100) return "CIEN";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let restText = "";
  if (rest < 30) restText = UNITS[rest] ?? "";
  else {
    const u = rest % 10;
    restText = `${TENS[Math.floor(rest / 10)]}${u ? ` Y ${UNITS[u]}` : ""}`;
  }
  if (apocope)
    restText = restText.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
  return [HUNDREDS[h], restText].filter(Boolean).join(" ");
}

// "UN MILLÓN NOVECIENTOS MIL", in capitals like the templates.
export function pesosInWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n >= 1e12)
    throw new PermanentError("El honorario tiene que ser un número entero");
  const millions = Math.floor(n / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions)
    parts.push(
      millions === 1
        ? "UN MILLÓN"
        : `${millions >= 1000 ? `${belowThousand(Math.floor(millions / 1000), true)} MIL ${belowThousand(millions % 1000, true)}`.trim() : belowThousand(millions, true)} MILLONES`,
    );
  if (thousands)
    parts.push(
      thousands === 1 ? "MIL" : `${belowThousand(thousands, true)} MIL`,
    );
  if (rest) parts.push(belowThousand(rest, false));
  return `PESOS ARGENTINOS ${parts.join(" ").replace(/\s+/g, " ")}`;
}

export const formatCuit = (cuit: string) => {
  const digits = cuit.replace(/\D/g, "");
  return digits.length === 11
    ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
    : cuit.trim();
};

// --- The document ---------------------------------------------------------

const quote = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// Text typed by people can't create new markers.
const plain = (value: string) => value.replace(/\{\{|\}\}/g, "").trim();

interface Paragraph {
  start: number;
  end: number;
  text: string;
}

async function paragraphs(docId: string): Promise<Paragraph[]> {
  const doc = await googleApi<{
    body: {
      content: {
        startIndex: number;
        endIndex: number;
        paragraph?: { elements: { textRun?: { content?: string } }[] };
      }[];
    };
  }>(`${DOCS}/${docId}`);
  return doc.body.content.flatMap((el) =>
    el.paragraph
      ? [
          {
            start: el.startIndex,
            end: el.endIndex,
            text: el.paragraph.elements
              .map((e) => e.textRun?.content ?? "")
              .join("")
              .replace(/\n$/, ""),
          },
        ]
      : [],
  );
}

export async function findTermsDoc(folderId: string, business: string) {
  const found = await googleApi<{ files?: { id: string }[] }>(
    `${DRIVE}/files?q=${encodeURIComponent(
      `${quote(folderId)} in parents and name = ${quote(termsName(business))} and trashed = false`,
    )}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  return found.files?.[0]?.id ?? null;
}

export async function writeTermsDoc(
  folderId: string,
  input: TermsInput,
  { replace }: { replace: boolean },
) {
  try {
    const name = termsName(input.nombreFantasia);
    const existing = await findTermsDoc(folderId, input.nombreFantasia);
    if (existing && !replace) return { conflict: true as const };

    const kind = termsKind(input.service);
    const copy = await googleApi<{ id: string }>(
      `${DRIVE}/files/${TERMS_TEMPLATES[kind]}/copy?fields=id&supportsAllDrives=true`,
      { method: "POST", body: { name, parents: [folderId] } },
    );
    const id = copy.id;

    // 1. Whole paragraphs: text, or removed when empty.
    const particulares = plain(input.condicionesParticulares);
    const blocks: Record<string, string> =
      kind === "gestion"
        ? {
            "{{ITEM_DISENO}}": input.incluyeDiseno ? DESIGN_ITEM : "",
            "{{DISENO}}": input.incluyeDiseno ? DESIGN_YES : DESIGN_NO,
            "{{DISENO_EXCLUSION}}": input.incluyeDiseno
              ? ""
              : DESIGN_NO_EXCLUSION,
            "{{CONDICIONES_PARTICULARES}}": particulares,
          }
        : { "{{CONDICIONES_PARTICULARES}}": particulares };
    const found = (await paragraphs(id)).filter(
      (p) => blocks[p.text] !== undefined,
    );
    if (found.length !== Object.keys(blocks).length)
      throw new PermanentError(
        "La plantilla de términos cambió: no encuentro todas sus marcas de párrafo",
      );
    const requests = found
      .sort((a, b) => b.start - a.start)
      .flatMap((p) => {
        const text = blocks[p.text] ?? "";
        return text
          ? [
              {
                deleteContentRange: {
                  range: { startIndex: p.start, endIndex: p.end - 1 },
                },
              },
              { insertText: { location: { index: p.start }, text } },
            ]
          : [
              {
                deleteContentRange: {
                  range: { startIndex: p.start, endIndex: p.end },
                },
              },
            ];
      });

    // 2. The data inside the text.
    const values: Record<string, string> = {
      RAZON_SOCIAL: plain(input.razonSocial).toUpperCase(),
      CUIT: formatCuit(plain(input.cuit)),
      NOMBRE_FANTASIA: plain(input.nombreFantasia),
      HONORARIO: formatPesos(input.honorario),
      HONORARIO_LETRAS: pesosInWords(input.honorario),
      MES_VALORES: plain(input.mesValores),
      ...(kind === "gestion"
        ? { PLATAFORMAS: PLATFORMS[input.service] ?? "Meta Ads" }
        : { FRECUENCIA: FREQUENCY[input.service] ?? "" }),
    };
    for (const [key, value] of Object.entries(values))
      if (!value) throw new PermanentError(`Falta el dato ${key}`);
    requests.push(
      ...(Object.entries(values).map(([key, value]) => ({
        replaceAllText: {
          containsText: { text: `{{${key}}}`, matchCase: true },
          replaceText: value,
        },
      })) as never[]),
    );
    await googleApi(`${DOCS}/${id}:batchUpdate`, {
      method: "POST",
      body: { requests },
    });

    // Nothing may be left unfilled.
    const left = (await paragraphs(id)).find((p) => p.text.includes("{{"));
    if (left) {
      await googleApi(`${DRIVE}/files/${id}?supportsAllDrives=true`, {
        method: "PATCH",
        body: { trashed: true },
      });
      throw new PermanentError(
        `Quedó una marca sin completar: "${left.text.slice(0, 80)}"`,
      );
    }

    // The previous one goes to the trash only once the new one is ready.
    if (existing)
      await googleApi(`${DRIVE}/files/${existing}?supportsAllDrives=true`, {
        method: "PATCH",
        body: { trashed: true },
      });
    return { conflict: false as const, fileId: id, name, url: termsUrl(id) };
  } catch (error) {
    throw asJobError(error);
  }
}
