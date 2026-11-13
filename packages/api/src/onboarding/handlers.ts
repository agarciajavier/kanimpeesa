import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import * as boardFieldRepo from "@kan/db/repository/boardField.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import {
  cards,
  onboardingClients,
  onboardingJobs,
  onboardingSubmissions,
} from "@kan/db/schema";

import type { AdminAnswers } from "./adminForm";
import type { JobRow } from "./queue";
import type { AccessStatus } from "./templates";
import { applyCardFieldValue } from "../utils/fieldAutomation";
import { baseUrl, getTargets, MS_FORMS_ADMIN_URL } from "./config";
import { folderUrl, prepareClientFolder, shareFolder } from "./drive";
import { sendTracked } from "./emails";
import { PermanentError, RetryableError } from "./errors";
import { enqueueJob, registerHandler } from "./queue";
import { panelReference, writeClientRow } from "./sheet";
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
};

for (const [kind, [fieldName, optionName]] of Object.entries(FIELD_JOBS))
  registerHandler(kind, async (db, job) => {
    const client = await loadClient(db, job.onboardingClientId);
    return { result: await setCardField(db, client, fieldName, optionName) };
  });

// --- Welcome email (template D5) ------------------------------------------

export const formLink = (token: string) => `${baseUrl()}/f/${token}`;

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

  const template = await readOnboardingTemplate();
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

export type { JobRow };
