import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import {
  cards,
  onboardingClients,
  onboardingDrafts,
  onboardingEmails,
  onboardingJobs,
  onboardingSubmissions,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { AdminAnswers } from "../onboarding/adminForm";
import { enqueueJob, formLink, retryJob, strategicLink } from "../onboarding";
import {
  ADMIN_FORM_VERSION,
  adminAnswersSchema,
} from "../onboarding/adminForm";
import {
  isLiveMode,
  ONBOARDING_NEW_CLIENT_LIST_PUBLIC_ID,
} from "../onboarding/config";
import {
  STRATEGIC_FORM_VERSION,
  strategicAnswersSchema,
  strategicDraftSchema,
} from "../onboarding/strategicForm";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

// Impeesa: the "Forms" section (client onboarding). See onboarding/handlers.ts
// for what happens after each step.

const requireUser = (id: string | undefined) => {
  if (!id)
    throw new TRPCError({
      message: "User not authenticated",
      code: "UNAUTHORIZED",
    });
  return id;
};

async function onboardingList(
  db: Parameters<typeof listRepo.getByPublicId>[0],
) {
  const list = await listRepo.getWorkspaceAndListIdByListPublicId(
    db,
    ONBOARDING_NEW_CLIENT_LIST_PUBLIC_ID,
  );
  if (!list)
    throw new TRPCError({
      message: 'No encuentro la lista "Nuevo cliente" del tablero Onboarding',
      code: "NOT_FOUND",
    });
  return list;
}

async function clientByToken(
  db: Parameters<typeof listRepo.getByPublicId>[0],
  token: string,
) {
  const client = await db.query.onboardingClients.findFirst({
    where: and(
      eq(onboardingClients.token, token),
      isNull(onboardingClients.deletedAt),
    ),
  });
  if (!client)
    throw new TRPCError({
      message: "Este enlace no es válido",
      code: "NOT_FOUND",
    });
  return client;
}

const tokenInput = z
  .string()
  .min(20)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const onboardingRouter = createTRPCRouter({
  // Clients in onboarding with the state of every step.
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUser(ctx.user?.id);
    const list = await onboardingList(ctx.db);
    await assertPermission(ctx.db, userId, list.workspaceId, "card:create");

    const clients = await ctx.db.query.onboardingClients.findMany({
      where: and(
        eq(onboardingClients.workspaceId, list.workspaceId),
        isNull(onboardingClients.deletedAt),
      ),
      orderBy: desc(onboardingClients.createdAt),
      limit: 100,
    });
    const ids = clients.map((c) => c.id);
    if (!ids.length) return { liveMode: isLiveMode(), clients: [] };

    const [jobs, emails, submissions, clientCards, drafts] = await Promise.all([
      ctx.db.query.onboardingJobs.findMany({
        where: inArray(onboardingJobs.onboardingClientId, ids),
        orderBy: onboardingJobs.id,
      }),
      ctx.db.query.onboardingEmails.findMany({
        where: inArray(onboardingEmails.onboardingClientId, ids),
      }),
      ctx.db.query.onboardingSubmissions.findMany({
        where: inArray(onboardingSubmissions.onboardingClientId, ids),
      }),
      ctx.db.query.cards.findMany({
        columns: { id: true, publicId: true },
        where: and(
          inArray(
            cards.id,
            clients.flatMap((c) => (c.cardId ? [c.cardId] : [])),
          ),
          isNull(cards.deletedAt),
        ),
      }),
      ctx.db.query.onboardingDrafts.findMany({
        columns: { onboardingClientId: true, updatedAt: true },
        where: inArray(onboardingDrafts.onboardingClientId, ids),
      }),
    ]);

    return {
      liveMode: isLiveMode(),
      clients: clients.map((c) => {
        const admin = submissions.find(
          (s) => s.onboardingClientId === c.id && s.form === "administrativa",
        );
        const answers = admin?.answers as AdminAnswers | undefined;
        const strategic = submissions.find(
          (s) => s.onboardingClientId === c.id && s.form === "estrategica",
        );
        return {
          publicId: c.publicId,
          firstName: c.firstName,
          email: c.email,
          isTest: c.isTest,
          cliCode: c.cliCode,
          business: answers?.nombreFantasia ?? null,
          contactEmail: answers?.correoContacto ?? null,
          driveFolderUrl: c.driveFolderUrl,
          cardPublicId:
            clientCards.find((card) => card.id === c.cardId)?.publicId ?? null,
          createdAt: c.createdAt,
          adminSubmittedAt: admin?.submittedAt ?? null,
          strategicSubmittedAt: strategic?.submittedAt ?? null,
          strategicDraftSavedAt:
            drafts.find((d) => d.onboardingClientId === c.id)?.updatedAt ??
            null,
          adminLink: formLink(c.token),
          strategicLink: strategicLink(c.token),
          jobs: jobs
            .filter((j) => j.onboardingClientId === c.id)
            .map((j) => ({
              id: j.id,
              kind: j.kind,
              status: j.status,
              attempts: j.attempts,
              lastError: j.lastError,
              result: j.result as Record<string, unknown> | null,
              nextRunAt: j.nextRunAt,
              doneAt: j.doneAt,
            })),
          emails: emails
            .filter((e) => e.onboardingClientId === c.id)
            .map((e) => ({
              kind: e.kind,
              toEmail: e.toEmail,
              status: e.status,
              createdAt: e.createdAt,
              deliveredAt: e.deliveredAt,
              openedAt: e.openedAt,
              bouncedAt: e.bouncedAt,
            })),
        };
      }),
    };
  }),

  // "Nuevo cliente": the card on the Onboarding board and the welcome email
  // with the personal link to the administrative form.
  create: protectedProcedure
    .input(
      z.object({
        firstName: z.string().trim().min(1).max(100),
        email: z.string().trim().toLowerCase().email().max(320),
        // Only in live mode: a test client (emails to the test inbox, test
        // Sheet and folder), to try something without a real client.
        isTest: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const list = await onboardingList(ctx.db);
      await assertPermission(ctx.db, userId, list.workspaceId, "card:create");

      // Real clients only once Ángel turns live mode on (ONBOARDING_MODE=
      // live in Railway). Until then every client is a test client.
      const isTest = isLiveMode() ? (input.isTest ?? false) : true;

      const card = await cardRepo.create(ctx.db, {
        title: input.firstName,
        description: null,
        createdBy: userId,
        listId: list.id,
        workspaceId: list.workspaceId,
        position: "end",
      });
      if (!card.id)
        throw new TRPCError({
          message: "No se pudo crear la tarjeta",
          code: "INTERNAL_SERVER_ERROR",
        });

      const [client] = await ctx.db
        .insert(onboardingClients)
        .values({
          publicId: generateUID(),
          token: randomBytes(24).toString("base64url"),
          workspaceId: list.workspaceId,
          firstName: input.firstName,
          email: input.email,
          isTest,
          cardId: card.id,
          createdBy: userId,
        })
        .returning();
      if (!client)
        throw new TRPCError({
          message: "No se pudo guardar el cliente",
          code: "INTERNAL_SERVER_ERROR",
        });

      await enqueueJob(ctx.db, {
        onboardingClientId: client.id,
        kind: "welcome_email",
      });
      return { publicId: client.publicId, cardPublicId: card.publicId };
    }),

  // Puts a stopped step back in the queue. Only that step runs again; what
  // was already done is kept.
  retry: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const job = await ctx.db.query.onboardingJobs.findFirst({
        where: eq(onboardingJobs.id, input.jobId),
      });
      const client = job
        ? await ctx.db.query.onboardingClients.findFirst({
            columns: { workspaceId: true },
            where: eq(onboardingClients.id, job.onboardingClientId),
          })
        : null;
      if (!job || !client)
        throw new TRPCError({
          message: "No existe ese paso",
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, client.workspaceId, "card:create");

      const retried = await retryJob(ctx.db, job.id);
      if (!retried)
        throw new TRPCError({
          message: "Ese paso no está detenido",
          code: "BAD_REQUEST",
        });
      return { ok: true };
    }),

  // --- Public: the client's form link (/f/<token>) ------------------------

  publicForm: publicProcedure
    .input(z.object({ token: tokenInput }))
    .query(async ({ ctx, input }) => {
      const client = await clientByToken(ctx.db, input.token);
      const submitted = await ctx.db.query.onboardingSubmissions.findFirst({
        columns: { id: true },
        where: and(
          eq(onboardingSubmissions.onboardingClientId, client.id),
          eq(onboardingSubmissions.form, "administrativa"),
        ),
      });
      return { firstName: client.firstName, submitted: !!submitted };
    }),

  submitAdministrativa: publicProcedure
    .input(z.object({ token: tokenInput, answers: adminAnswersSchema }))
    .mutation(async ({ ctx, input }) => {
      const client = await clientByToken(ctx.db, input.token);

      const [saved] = await ctx.db
        .insert(onboardingSubmissions)
        .values({
          publicId: generateUID(),
          onboardingClientId: client.id,
          form: "administrativa",
          formVersion: ADMIN_FORM_VERSION,
          answers: input.answers,
        })
        .onConflictDoNothing()
        .returning({ id: onboardingSubmissions.id });
      // Already sent: nothing runs again.
      if (!saved) return { alreadySubmitted: true };

      for (const kind of ["field:ficha_done", "sheet_row", "drive_folder"])
        await enqueueJob(ctx.db, { onboardingClientId: client.id, kind });
      return { alreadySubmitted: false };
    }),

  // --- Public: the strategic form (/f/<token>/estrategica) -----------------
  // Long, so what the client types is saved as a draft in the panel and
  // they can come back later, from any device, with the same link.

  publicStrategic: publicProcedure
    .input(z.object({ token: tokenInput }))
    .query(async ({ ctx, input }) => {
      const client = await clientByToken(ctx.db, input.token);
      const [admin, strategic, draft] = await Promise.all([
        ctx.db.query.onboardingSubmissions.findFirst({
          columns: { answers: true },
          where: and(
            eq(onboardingSubmissions.onboardingClientId, client.id),
            eq(onboardingSubmissions.form, "administrativa"),
          ),
        }),
        ctx.db.query.onboardingSubmissions.findFirst({
          columns: { id: true },
          where: and(
            eq(onboardingSubmissions.onboardingClientId, client.id),
            eq(onboardingSubmissions.form, "estrategica"),
          ),
        }),
        ctx.db.query.onboardingDrafts.findFirst({
          where: and(
            eq(onboardingDrafts.onboardingClientId, client.id),
            eq(onboardingDrafts.form, "estrategica"),
          ),
        }),
      ]);
      const adminAnswers = admin?.answers as AdminAnswers | undefined;
      const parsedDraft = draft
        ? strategicDraftSchema.safeParse(draft.answers)
        : null;
      return {
        firstName: client.firstName,
        business: adminAnswers?.nombreFantasia ?? null,
        // The brief goes in the client's folder, made after the first form.
        adminDone: !!admin,
        submitted: !!strategic,
        draft:
          draft && parsedDraft?.success
            ? {
                answers: parsedDraft.data,
                step: draft.step,
                savedAt: draft.updatedAt,
              }
            : null,
      };
    }),

  saveStrategicDraft: publicProcedure
    .input(
      z.object({
        token: tokenInput,
        answers: strategicDraftSchema,
        step: z.number().int().min(0).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await clientByToken(ctx.db, input.token);
      const sent = await ctx.db.query.onboardingSubmissions.findFirst({
        columns: { id: true },
        where: and(
          eq(onboardingSubmissions.onboardingClientId, client.id),
          eq(onboardingSubmissions.form, "estrategica"),
        ),
      });
      if (sent) return { savedAt: null, alreadySubmitted: true };

      const now = new Date();
      await ctx.db
        .insert(onboardingDrafts)
        .values({
          onboardingClientId: client.id,
          form: "estrategica",
          formVersion: STRATEGIC_FORM_VERSION,
          answers: input.answers,
          step: input.step,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [onboardingDrafts.onboardingClientId, onboardingDrafts.form],
          set: {
            answers: input.answers,
            step: input.step,
            formVersion: STRATEGIC_FORM_VERSION,
            updatedAt: now,
          },
        });
      return { savedAt: now, alreadySubmitted: false };
    }),

  submitEstrategica: publicProcedure
    .input(z.object({ token: tokenInput, answers: strategicAnswersSchema }))
    .mutation(async ({ ctx, input }) => {
      const client = await clientByToken(ctx.db, input.token);
      const admin = await ctx.db.query.onboardingSubmissions.findFirst({
        columns: { id: true },
        where: and(
          eq(onboardingSubmissions.onboardingClientId, client.id),
          eq(onboardingSubmissions.form, "administrativa"),
        ),
      });
      if (!admin)
        throw new TRPCError({
          message: "Primero tiene que estar enviada la ficha inicial",
          code: "PRECONDITION_FAILED",
        });

      const [saved] = await ctx.db
        .insert(onboardingSubmissions)
        .values({
          publicId: generateUID(),
          onboardingClientId: client.id,
          form: "estrategica",
          formVersion: STRATEGIC_FORM_VERSION,
          answers: input.answers,
        })
        .onConflictDoNothing()
        .returning({ id: onboardingSubmissions.id });
      // Already sent: the brief is never made twice.
      if (!saved) return { alreadySubmitted: true };

      await ctx.db
        .delete(onboardingDrafts)
        .where(
          and(
            eq(onboardingDrafts.onboardingClientId, client.id),
            eq(onboardingDrafts.form, "estrategica"),
          ),
        );
      await enqueueJob(ctx.db, {
        onboardingClientId: client.id,
        kind: "brief_summary",
      });
      return { alreadySubmitted: false };
    }),
});
