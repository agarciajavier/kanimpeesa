import { CLIENTS_TAB } from "./config";
import { PermanentError } from "./errors";
import { asJobError, googleApi } from "./google";

// Impeesa onboarding: the client's row in the "Clientes" tab of the billing
// Sheet. Columns are found by their header (row 1), never by letter, so
// moving or adding columns doesn't break it.
//
// The row is found again by its Observaciones ("Panel ID: <id>"), so running
// this twice never adds a second row. Formulas, formats and validations come
// from the row above, the way the Sheet's own rows have them.

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

export const REQUIRED_HEADERS = {
  id: "ID Cliente",
  estado: "Estado",
  negocio: "Negocio",
  razonSocial: "Razón social / Contacto",
  emailPrincipal: "Email principal",
  emailsAlternativos: "Emails alternativos",
  observaciones: "Observaciones",
  cobrarInteres: "Cobrar interés",
  modalidad: "Modalidad de facturación",
  emisor: "Emisor",
  descripcion: "Descripción del servicio",
  accion: "Acción sobre el cliente",
  cuit: "CUIT",
  condicionIva: "Condición frente al IVA",
} as const;

export type ClientRowValues = Record<
  Exclude<keyof typeof REQUIRED_HEADERS, "id" | "observaciones">,
  string
>;

const normalize = (value: string) => value.trim().toLowerCase();

function columnLetter(index: number) {
  let letter = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    letter = String.fromCharCode(65 + rest) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

export const panelReference = (publicId: string) => `Panel ID: ${publicId}`;

export async function writeClientRow(
  sheetId: string,
  {
    reference,
    values,
  }: {
    // Goes in Observaciones and identifies the row.
    reference: string;
    values: ClientRowValues;
  },
): Promise<{ cliCode: string; rowNumber: number; reused: boolean }> {
  try {
    const tab = encodeURIComponent(CLIENTS_TAB);
    const meta = await googleApi<{
      sheets: { properties: { sheetId: number; title: string } }[];
    }>(`${SHEETS}/${sheetId}?fields=sheets.properties(sheetId,title)`);
    const gridId = meta.sheets.find((s) => s.properties.title === CLIENTS_TAB)
      ?.properties.sheetId;
    if (gridId === undefined)
      throw new PermanentError(`No existe la pestaña "${CLIENTS_TAB}"`);

    const grid = await googleApi<{ values?: string[][] }>(
      `${SHEETS}/${sheetId}/values/${tab}!A1:ZZ2000?valueRenderOption=FORMULA`,
    );
    const rows = grid.values ?? [];
    const headers = (rows[0] ?? []).map((h) => normalize(String(h)));

    const column = {} as Record<keyof typeof REQUIRED_HEADERS, number>;
    for (const [key, header] of Object.entries(REQUIRED_HEADERS)) {
      const index = headers.indexOf(normalize(header));
      if (index < 0)
        throw new PermanentError(
          `No encuentro la columna "${header}" en "${CLIENTS_TAB}"`,
        );
      column[key as keyof typeof REQUIRED_HEADERS] = index;
    }
    const width = headers.length;
    const lastCol = columnLetter(width - 1);

    // Already written (a retry): reuse it.
    const existing = rows.findIndex(
      (row, i) =>
        i > 0 && String(row[column.observaciones] ?? "").includes(reference),
    );

    let rowNumber: number;
    let cliCode: string;
    let reused = false;

    if (existing > 0) {
      rowNumber = existing + 1;
      cliCode = String(rows[existing]?.[column.id] ?? "");
      reused = true;
    } else {
      let lastDataIndex = 0;
      let highest = 0;
      rows.forEach((row, i) => {
        const id = String(row[column.id] ?? "").trim();
        if (i > 0 && id) lastDataIndex = i;
        const match = /^CLI-(\d+)$/.exec(id);
        if (match) highest = Math.max(highest, Number(match[1]));
      });
      if (lastDataIndex === 0)
        throw new PermanentError(
          "La pestaña Clientes no tiene filas de ejemplo",
        );

      cliCode = `CLI-${String(highest + 1).padStart(3, "0")}`;
      rowNumber = lastDataIndex + 2;

      // Values first, so that if anything later fails the row is already
      // findable by its reference. Formula columns are left alone (null).
      const source = rows[lastDataIndex] ?? [];
      const mapped: Partial<Record<number, string>> = {
        [column.id]: cliCode,
        [column.observaciones]: reference,
        [column.estado]: values.estado,
        [column.negocio]: values.negocio,
        [column.razonSocial]: values.razonSocial,
        [column.emailPrincipal]: values.emailPrincipal,
        [column.emailsAlternativos]: values.emailsAlternativos,
        [column.cobrarInteres]: values.cobrarInteres,
        [column.modalidad]: values.modalidad,
        [column.emisor]: values.emisor,
        [column.descripcion]: values.descripcion,
        [column.accion]: values.accion,
        [column.cuit]: values.cuit,
        [column.condicionIva]: values.condicionIva,
      };
      const row = Array.from({ length: width }, (_, i) => {
        if (mapped[i] !== undefined) return mapped[i];
        return String(source[i] ?? "").startsWith("=") ? null : "";
      });

      // RAW: nothing is interpreted, so a CUIT stays text and an answer
      // starting with "=" is never run as a formula.
      await googleApi(
        `${SHEETS}/${sheetId}/values/${tab}!A${rowNumber}:${lastCol}${rowNumber}?valueInputOption=RAW`,
        { method: "PUT", body: { values: [row] } },
      );
    }

    // Formats, validations and formulas from the row above. Pasting only
    // these never overwrites the values just written.
    const above = rows[rowNumber - 2] ?? [];
    // Columns this code fills keep their values even if the row above has a
    // formula there.
    const ownColumns = new Set(Object.values(column));
    const formulaColumns = above
      .map((cell, i) => (String(cell ?? "").startsWith("=") ? i : -1))
      .filter((i) => i >= 0 && !ownColumns.has(i));
    const range = (row: number, start: number, end: number) => ({
      sheetId: gridId,
      startRowIndex: row - 1,
      endRowIndex: row,
      startColumnIndex: start,
      endColumnIndex: end,
    });
    await googleApi(`${SHEETS}/${sheetId}:batchUpdate`, {
      method: "POST",
      body: {
        requests: [
          ...(["PASTE_FORMAT", "PASTE_DATA_VALIDATION"] as const).map(
            (pasteType) => ({
              copyPaste: {
                source: range(rowNumber - 1, 0, width),
                destination: range(rowNumber, 0, width),
                pasteType,
              },
            }),
          ),
          ...formulaColumns.map((i) => ({
            copyPaste: {
              source: range(rowNumber - 1, i, i + 1),
              destination: range(rowNumber, i, i + 1),
              pasteType: "PASTE_FORMULA",
            },
          })),
        ],
      },
    });

    return { cliCode, rowNumber, reused };
  } catch (error) {
    throw asJobError(error);
  }
}
