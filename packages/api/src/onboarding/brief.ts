import type { BriefSection } from "./ai";
import { PermanentError } from "./errors";
import { asJobError, googleApi } from "./google";

// Impeesa onboarding: the "Brief de marca <Negocio>" Google Doc in the
// client's folder. First the answers exactly as the client wrote them, then
// the summary and the conclusion, clearly apart. The doc is looked up before
// being created, so a retry never makes a second one.

const DRIVE = "https://www.googleapis.com/drive/v3";
const DOCS = "https://docs.googleapis.com/v1/documents";
const DOC_MIME = "application/vnd.google-apps.document";

export const briefName = (business: string) =>
  `Brief de marca ${business.trim()}`;
export const docUrl = (id: string) =>
  `https://docs.google.com/document/d/${id}/edit`;

const quote = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

type Style = "TITLE" | "HEADING_1" | "HEADING_2" | "NORMAL_TEXT";
interface Block {
  text: string;
  style: Style;
  bold?: boolean;
  italic?: boolean;
}

function buildBlocks(input: {
  business: string;
  submittedAt: Date;
  sections: BriefSection[];
  resumen: string;
  conclusion: string;
}): Block[] {
  const date = input.submittedAt.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const blocks: Block[] = [
    { text: briefName(input.business), style: "TITLE" },
    {
      text: `Ficha estratégica enviada por el cliente el ${date}.`,
      style: "NORMAL_TEXT",
      italic: true,
    },
    { text: "Respuestas del cliente", style: "HEADING_1" },
    {
      text: "Transcriptas tal como las escribió el cliente, sin correcciones ni resúmenes.",
      style: "NORMAL_TEXT",
      italic: true,
    },
  ];
  for (const section of input.sections) {
    blocks.push({ text: section.title, style: "HEADING_2" });
    for (const q of section.questions) {
      blocks.push({ text: q.label, style: "NORMAL_TEXT", bold: true });
      blocks.push({ text: q.answer, style: "NORMAL_TEXT" });
      blocks.push({ text: "", style: "NORMAL_TEXT" });
    }
  }
  blocks.push(
    { text: "Resumen", style: "HEADING_1" },
    {
      text: "Escrito con IA a partir de las respuestas de arriba. Revisarlo antes de usarlo.",
      style: "NORMAL_TEXT",
      italic: true,
    },
    { text: input.resumen, style: "NORMAL_TEXT" },
    { text: "Conclusión", style: "HEADING_1" },
    {
      text: "Escrita con IA a partir de las respuestas de arriba. Revisarla antes de usarla.",
      style: "NORMAL_TEXT",
      italic: true,
    },
    { text: input.conclusion, style: "NORMAL_TEXT" },
  );
  return blocks;
}

// One insertText with everything, then the styles by range. Docs counts
// positions in UTF-16 units, like JavaScript strings; the body starts at 1.
function buildRequests(blocks: Block[]) {
  const clean = (text: string) =>
    text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F]/g, "");
  let text = "";
  const styles: unknown[] = [];
  for (const block of blocks) {
    const start = 1 + text.length;
    const body = clean(block.text);
    text += `${body}\n`;
    const end = 1 + text.length;
    styles.push({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle: { namedStyleType: block.style },
        fields: "namedStyleType",
      },
    });
    if ((block.bold || block.italic) && body.length)
      styles.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: start + body.length },
          textStyle: { bold: !!block.bold, italic: !!block.italic },
          fields: "bold,italic",
        },
      });
  }
  return [{ insertText: { location: { index: 1 }, text } }, ...styles];
}

export async function writeBriefDoc(
  folderId: string,
  input: Parameters<typeof buildBlocks>[0],
): Promise<{ id: string; url: string; reused: boolean }> {
  const name = briefName(input.business);
  try {
    const q = `${quote(folderId)} in parents and name = ${quote(name)} and mimeType = '${DOC_MIME}' and trashed = false`;
    const found = await googleApi<{ files: { id: string }[] }>(
      `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    );
    if (found.files.length > 1)
      throw new PermanentError(
        `Hay ${found.files.length} documentos "${name}" en la carpeta; no elijo uno por mi cuenta`,
      );

    let id = found.files[0]?.id;
    if (id) {
      // Already there: written before, unless a previous attempt stopped
      // right after creating it empty.
      const doc = await googleApi<{
        body?: { content?: { endIndex?: number }[] };
      }>(`${DOCS}/${id}?fields=body.content.endIndex`);
      const end = doc.body?.content?.at(-1)?.endIndex ?? 0;
      if (end > 2) return { id, url: docUrl(id), reused: true };
    } else {
      const created = await googleApi<{ id: string }>(
        `${DRIVE}/files?fields=id&supportsAllDrives=true`,
        {
          method: "POST",
          body: { name, mimeType: DOC_MIME, parents: [folderId] },
        },
      );
      id = created.id;
    }

    await googleApi(`${DOCS}/${id}:batchUpdate`, {
      method: "POST",
      body: { requests: buildRequests(buildBlocks(input)) },
    });
    return { id, url: docUrl(id), reused: false };
  } catch (error) {
    throw asJobError(error);
  }
}
