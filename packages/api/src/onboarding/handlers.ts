import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import * as boardFieldRepo from "@kan/db/repository/boardField.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as clientRepo from "@kan/db/repository/client.repo";
import {
  cards,
  clients,
  onboardingClients,
  onboardingJobs,
  onboardingSubmissions,
} from "@kan/db/schema";

import type { AdminAnswers } from "./adminForm";
import type { BriefSection } from "./ai";
import type { JobRow } from "./queue";
import type { StrategicAnswers } from "./strategicForm";
import type { AccessStatus } from "./templates";
import { applyCardFieldValue } from "../utils/fieldAutomation";
import { summarizeBrief } from "./ai";
import { writeBriefDoc } from "./brief";
import {
  baseUrl,
  getTargets,
  MS_FORMS_ADMIN_URL,
  MS_FORMS_STRATEGIC_URL,
} from "./config";
import { folderUrl, prepareClientFolder, shareFolder } from "./drive";
import { sendTracked } from "./emails";
import { PermanentError, RetryableError } from "./errors";
import { enqueueJob, registerHandler } from "./queue";
import { panelReference, writeClientRow } from "./sheet";
import {
  answerText,
  STRATEGIC_SECTIONS,
  STRATEGIC_TEXT,
  strategicQuestions,
} from "./strategicForm";
import {
  escapeHtml,
  fill,
  readOnboardingTemplate,
  readWelcomeTemplate,
} from "./templates";

// Impeesa onboarding: what each job does. Every handler checks what is
// already done before acting, so running it twice is harmless.
//
//   Nuevo cliente ─► welcome_email ─► field:welcome_sent
//   Ficha enviada ─► field:ficha_done
//                 ─► sheet_row   ─► card_details
//                 ─► drive_folder ─► card_details
//                                 ─► drive_share ─► onboarding_email
//                                                ─► field:folder_shared|sent
//   Ficha estratégica enviada ─► brief_summary ─► brief_doc ─► field:brief_done

async function loadClient(db: dbClient, id: number) {
  const client = await db.query.onboardingClients.findFirst({
    where: and(
      eq(onboardingClients.id, id),
      isNull(onboardingClients.deletedAt),
    ),
  });
  if (!client)
    throw new PermanentError("El cliente del onboarding fue borrado");
  return client;
}

async function loadAdminAnswers(db: dbClient, clientId: number) {
  const submission = await db.query.onboardingSubmissions.findFirst({
    where: and(
      eq(onboardingSubmissions.onboardingClientId, clientId),
      eq(onboardingSubmissions.form, "administrativa"),
    ),
  });
  if (!submission)
    throw new PermanentError("No está guardada la ficha administrativa");
  return submission.answers as AdminAnswers;
}

async function jobResult<T>(db: dbClient, clientId: number, kind: string) {
  const job = await db.query.onboardingJobs.findFirst({
    where: and(
      eq(onboardingJobs.onboardingClientId, clientId),
      eq(onboardingJobs.kind, kind),
      eq(onboardingJobs.status, "done"),
    ),
  });
  return (job?.result ?? null) as T | null;
}

type Client = Awaited<ReturnType<typeof loadClient>>;

async function cardOf(db: dbClient, client: Client) {
  const card = client.cardId
    ? await db.query.cards.findFirst({
        columns: { publicId: true },
        where: and(eq(cards.id, client.cardId), isNull(cards.deletedAt)),
      })
    : null;
  if (!card) throw new PermanentError("La tarjeta del cliente fue borrada");
  const context = await boardFieldRepo.getCardContext(db, card.publicId);
  if (!context) throw new PermanentError("La tarjeta del cliente fue borrada");
  return { publicId: card.publicId, context };
}

// Sets a field of the card through the same code as a change by hand, so
// the board's automations run.
async function setCardField(
  db: dbClient,
  client: Client,
  fieldName: string,
  optionName: string,
) {
  const card = await cardOf(db, client);
  const fields = await boardFieldRepo.getAllByBoardId(db, card.context.boardId);
  const fieldRef = fields.find((f) => f.name === fieldName);
  const field = fieldRef
    ? await boardFieldRepo.getByPublicId(db, fieldRef.publicId)
    : null;
  const option = field?.options.find((o) => o.name === optionName);
  if (!field || !option)
    throw new PermanentError(
      `En el tablero no existe el campo "${fieldName}" con la opción "${optionName}"`,
    );

  const actor = client.createdBy ?? card.context.createdBy;
  if (!actor)
    throw new PermanentError("No sé a nombre de quién registrar el cambio");

  const change = await applyCardFieldValue(db, {
    card: card.context,
    cardPublicId: card.publicId,
    field,
    option,
    userId: actor,
    userName: "Onboarding",
    notifyActor: true,
  });
  return { field: fieldName, option: optionName, ...change };
}

const FIELD_JOBS: Record<string, [string, string]> = {
  "field:welcome_sent": ["Mail de bienvenida", "Enviado"],
  "field:ficha_done": ["Ficha administrativa", "Completada"],
  "field:folder_shared": ["Carpeta compartida", "Compartida"],
  "field:folder_sent": ["Carpeta compartida", "Enviada"],
  "field:brief_done": ["Brief de marca", "Listo"],
};

for (const [kind, [fieldName, optionName]] of Object.entries(FIELD_JOBS))
  registerHandler(kind, async (db, job) => {
    const client = await loadClient(db, job.onboardingClientId);
    return { result: await setCardField(db, client, fieldName, optionName) };
  });

// --- Welcome email (template D5) ------------------------------------------

export const formLink = (token: string) => `${baseUrl()}/f/${token}`;
export const strategicLink = (token: string) =>
  `${baseUrl()}/f/${token}/estrategica`;

registerHandler("welcome_email", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const targets = getTargets(client.isTest);
  const template = await readWelcomeTemplate();

  // The Microsoft Forms link is replaced by the client's own link to the
  // panel's form. It must be there, or the template changed and nothing is
  // sent.
  if (!template.html.includes(MS_FORMS_ADMIN_URL))
    throw new PermanentError(
      `La plantilla D5 ya no tiene el enlace ${MS_FORMS_ADMIN_URL}; no sé dónde poner el de la ficha nueva`,
    );
  const link = escapeHtml(formLink(client.token));
  const withLink = {
    subject: template.subject,
    html: template.html.split(MS_FORMS_ADMIN_URL).join(link),
  };

  const email = fill(withLink, { NOMBRE: client.firstName });
  const sent = await sendTracked(db, {
    client,
    kind: "bienvenida",
    to: client.email,
    subject: email.subject,
    html: email.html,
    targets,
  });

  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: "field:welcome_sent",
  });
  return { result: sent };
});

// --- Sheet row ------------------------------------------------------------

registerHandler("sheet_row", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const targets = getTargets(client.isTest);
  const a = await loadAdminAnswers(db, client.id);

  const sameEmail = a.facturaMismoCorreo === "SI";
  const taxId = a.cuit ?? a.dni ?? a.idFiscalExterior;
  if (!taxId)
    throw new PermanentError("Falta el CUIT, DNI o identificador fiscal");

  const row = await writeClientRow(targets.sheetId, {
    reference: panelReference(client.publicId),
    values: {
      estado: "Activo",
      negocio: a.nombreFantasia,
      razonSocial: a.razonSocial,
      emailPrincipal: sameEmail ? a.correoContacto : (a.correoFactura ?? ""),
      emailsAlternativos:
        !sameEmail && a.correoFactura !== a.correoContacto
          ? a.correoContacto
          : "",
      // As in every row the previous automation wrote.
      cobrarInteres: "No",
      modalidad: "Adelantado",
      emisor: a.situacionFiscal === "Responsable Inscripto" ? "Ángel" : "Euge",
      descripcion: a.servicio,
      accion: "Sin cambios",
      cuit: taxId,
      condicionIva: a.situacionFiscal,
    },
  });
  if (!row.cliCode) throw new PermanentError("La fila quedó sin ID Cliente");

  await db
    .update(onboardingClients)
    .set({ cliCode: row.cliCode, updatedAt: new Date() })
    .where(eq(onboardingClients.id, client.id));
  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: "card_details",
    dedupKey: `${client.id}:card_details:sheet`,
  });
  return { result: row };
});

// --- Drive folder and sharing ----------------------------------------------

registerHandler("drive_folder", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const targets = getTargets(client.isTest);
  const a = await loadAdminAnswers(db, client.id);

  const folder = await prepareClientFolder(
    targets.clientsFolderId,
    a.nombreFantasia,
  );
  await db
    .update(onboardingClients)
    .set({
      driveFolderId: folder.id,
      driveFolderUrl: folder.url,
      updatedAt: new Date(),
    })
    .where(eq(onboardingClients.id, client.id));

  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: "card_details",
    dedupKey: `${client.id}:card_details:folder`,
  });
  await enqueueJob(db, { onboardingClientId: client.id, kind: "panel_client" });
  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: "drive_share",
    maxAttempts: 4,
  });
  return { result: folder };
});

registerHandler("drive_share", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const a = await loadAdminAnswers(db, client.id);
  if (!client.driveFolderId)
    throw new RetryableError("La carpeta todavía no está creada");

  const share = await shareFolder(client.driveFolderId, a.correoContacto, {
    // In test mode Google doesn't email the address typed in the form.
    notify: !client.isTest,
    lastAttempt: job.attempts >= job.maxAttempts,
  });

  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: "onboarding_email",
  });
  if (share.access === "edicion")
    await enqueueJob(db, {
      onboardingClientId: client.id,
      kind: "field:folder_shared",
    });
  return { result: { ...share, email: a.correoContacto } };
});

// --- Second email (template D6) -------------------------------------------

registerHandler("onboarding_email", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const targets = getTargets(client.isTest);
  const a = await loadAdminAnswers(db, client.id);
  const share = await jobResult<{ access: AccessStatus }>(
    db,
    client.id,
    "drive_share",
  );
  if (!share || !client.driveFolderId)
    throw new RetryableError("Falta el resultado de compartir la carpeta");

  const loaded = await readOnboardingTemplate();
  // The strategic form link (Microsoft Forms) is replaced by the client's
  // own link to the panel's form. It must be there, or the template changed
  // and nothing is sent.
  if (!MS_FORMS_STRATEGIC_URL.test(loaded.html))
    throw new PermanentError(
      "La plantilla D6 ya no tiene el enlace de la ficha estratégica de Microsoft Forms; no sé dónde poner el nuevo",
    );
  const template = {
    ...loaded,
    html: loaded.html.replace(
      new RegExp(MS_FORMS_STRATEGIC_URL.source, "g"),
      escapeHtml(strategicLink(client.token)),
    ),
  };
  const variant = template.accessVariants[share.access];
  if (!variant)
    throw new PermanentError(
      `No hay frase aprobada para el acceso "${share.access}"`,
    );

  const values = {
    NOMBRE: a.nombreContacto,
    NEGOCIO: a.nombreFantasia,
    LINK_CARPETA: folderUrl(client.driveFolderId),
    CORREO_CONTACTO: a.correoContacto,
  };
  // The access sentence has its own {{CORREO_CONTACTO}}.
  const accessHtml = fill(
    { subject: "-", html: variant },
    {
      CORREO_CONTACTO: a.correoContacto,
    },
  ).html;
  const email = fill(template, values, {
    rawHtml: { ESTADO_ACCESO: accessHtml },
  });

  // Always the contact email, never the billing one.
  const sent = await sendTracked(db, {
    client,
    kind: "onboarding",
    to: a.correoContacto,
    subject: email.subject,
    html: email.html,
    targets,
  });

  if (share.access !== "edicion")
    await enqueueJob(db, {
      onboardingClientId: client.id,
      kind: "field:folder_sent",
    });
  return { result: { ...sent, access: share.access } };
});

// --- Client in the panel (Clientes page) -----------------------------------

// The business becomes a client of the panel, with its Drive folder, and the
// card is linked to it (so the card shows "Carpeta de X"). An existing client
// with the same name is reused, never duplicated. Test clients are named
// "[PRUEBA] ..." so they're never mistaken for real ones.
registerHandler("panel_client", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const a = await loadAdminAnswers(db, client.id);
  const card = await cardOf(db, client);
  if (!client.driveFolderUrl)
    throw new RetryableError("La carpeta todavía no está creada");

  const name =
    `${client.isTest ? "[PRUEBA] " : ""}${a.nombreFantasia.trim()}`.slice(
      0,
      255,
    );
  const actor = client.createdBy ?? card.context.createdBy;
  if (!actor)
    throw new PermanentError("No sé a nombre de quién crear el cliente");

  let panelClient = client.clientId
    ? await db.query.clients.findFirst({
        columns: { id: true, driveUrl: true },
        where: and(eq(clients.id, client.clientId), isNull(clients.deletedAt)),
      })
    : undefined;
  panelClient ??= await db.query.clients.findFirst({
    columns: { id: true, driveUrl: true },
    where: and(
      eq(clients.workspaceId, client.workspaceId),
      eq(clients.name, name),
      isNull(clients.deletedAt),
    ),
  });
  let created = false;
  if (!panelClient) {
    await clientRepo.create(db, {
      name,
      status: "starting",
      type: a.servicio.startsWith("Asesoría") ? "advisory" : "management",
      driveUrl: client.driveFolderUrl,
      briefUrl: null,
      summary: null,
      workspaceId: client.workspaceId,
      createdBy: actor,
    });
    panelClient = await db.query.clients.findFirst({
      columns: { id: true, driveUrl: true },
      where: and(
        eq(clients.workspaceId, client.workspaceId),
        eq(clients.name, name),
        isNull(clients.deletedAt),
      ),
    });
    created = true;
  } else if (!panelClient.driveUrl) {
    await db
      .update(clients)
      .set({ driveUrl: client.driveFolderUrl, updatedAt: new Date() })
      .where(eq(clients.id, panelClient.id));
  }
  if (!panelClient)
    throw new RetryableError("No se pudo crear el cliente del panel");

  await db
    .update(onboardingClients)
    .set({ clientId: panelClient.id, updatedAt: new Date() })
    .where(eq(onboardingClients.id, client.id));
  await clientRepo.setCardClient(db, {
    cardId: card.context.id,
    clientId: panelClient.id,
  });
  return { result: { name, created } };
});

// --- Card title and description --------------------------------------------

registerHandler("card_details", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const a = await loadAdminAnswers(db, client.id);
  const card = await cardOf(db, client);

  const lines = [
    client.cliCode
      ? `<p><strong>${escapeHtml(client.cliCode)}</strong> · ${escapeHtml(a.razonSocial)}</p>`
      : null,
    `<p>Contacto: ${escapeHtml(a.nombreContacto)} · ${escapeHtml(a.correoContacto)} · ${escapeHtml(a.telefono)}</p>`,
    `<p>Servicio: ${escapeHtml(a.servicio)}</p>`,
    client.driveFolderUrl
      ? `<p>Carpeta: <a href="${escapeHtml(client.driveFolderUrl)}">${escapeHtml(client.driveFolderUrl)}</a></p>`
      : null,
    client.isTest ? "<p><em>Cliente de PRUEBA</em></p>" : null,
  ].filter(Boolean);
  const description = lines.join("");
  const title = a.nombreFantasia;

  const current = await db.query.cards.findFirst({
    columns: { title: true, description: true },
    where: eq(cards.publicId, card.publicId),
  });
  if (current?.title === title && current.description === description)
    return { result: { unchanged: true } };

  await cardRepo.update(
    db,
    { title, description },
    { cardPublicId: card.publicId },
  );
  const actor = client.createdBy ?? card.context.createdBy;
  if (actor && current?.title !== title)
    await cardActivityRepo.create(db, {
      type: "card.updated.title",
      cardId: card.context.id,
      fromTitle: current?.title,
      toTitle: title,
      createdBy: actor,
    });
  return { result: { title } };
});

// --- Strategic form: the brief --------------------------------------------

async function loadStrategic(db: dbClient, clientId: number) {
  const submission = await db.query.onboardingSubmissions.findFirst({
    where: and(
      eq(onboardingSubmissions.onboardingClientId, clientId),
      eq(onboardingSubmissions.form, "estrategica"),
    ),
  });
  if (!submission)
    throw new PermanentError("No está guardada la ficha estratégica");
  return {
    answers: submission.answers as StrategicAnswers,
    submittedAt: submission.submittedAt,
  };
}

// The answers grouped as in the form, exactly as the client wrote them.
function briefSections(answers: StrategicAnswers): BriefSection[] {
  const sections: BriefSection[] = [];
  for (const q of strategicQuestions(answers)) {
    const title = STRATEGIC_SECTIONS[q.section].title;
    let section = sections.find((s) => s.title === title);
    if (!section) {
      section = { title, questions: [] };
      sections.push(section);
    }
    section.questions.push({
      label: STRATEGIC_TEXT[q.field].label,
      answer: answerText(answers[q.field]),
    });
  }
  return sections;
}

// The summary and conclusion, written once and kept in the job's result so
// a retry of the document doesn't write different ones.
registerHandler("brief_summary", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const admin = await loadAdminAnswers(db, client.id);
  const { answers } = await loadStrategic(db, client.id);
  const summary = await summarizeBrief(
    admin.nombreFantasia,
    briefSections(answers),
  );
  await enqueueJob(db, { onboardingClientId: client.id, kind: "brief_doc" });
  return { result: summary };
});

registerHandler("brief_doc", async (db, job) => {
  const client = await loadClient(db, job.onboardingClientId);
  const admin = await loadAdminAnswers(db, client.id);
  const { answers, submittedAt } = await loadStrategic(db, client.id);
  const summary = await jobResult<{ resumen: string; conclusion: string }>(
    db,
    client.id,
    "brief_summary",
  );
  if (!summary) throw new RetryableError("Falta el resumen del brief");
  if (!client.driveFolderId)
    throw new RetryableError("La carpeta del cliente todavía no está creada");

  const doc = await writeBriefDoc(client.driveFolderId, {
    business: admin.nombreFantasia,
    submittedAt,
    sections: briefSections(answers),
    resumen: summary.resumen,
    conclusion: summary.conclusion,
  });

  // The panel client shows it as its brief.
  if (client.clientId)
    await db
      .update(clients)
      .set({ briefUrl: doc.url, updatedAt: new Date() })
      .where(and(eq(clients.id, client.clientId), isNull(clients.briefUrl)));
  await enqueueJob(db, {
    onboardingClientId: client.id,
    kind: "field:brief_done",
  });
  return { result: doc };
});

export type { JobRow };
