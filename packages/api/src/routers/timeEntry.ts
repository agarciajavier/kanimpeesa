import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as timeEntryRepo from "@kan/db/repository/timeEntry.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission, hasPermission } from "../utils/permissions";

// Impeesa: time tracking (see db/schema/timeEntries.ts). Anyone who can edit
// cards logs their own time (guests don't); nobody logs time for someone
// else.

const requireUser = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

const getCard = async (
  db: dbClient,
  userId: string,
  cardPublicId: string,
  permission: "card:view" | "card:edit",
) => {
  const card = await timeEntryRepo.getCardContext(db, cardPublicId);

  if (!card)
    throw new TRPCError({
      message: `Card with public ID ${cardPublicId} not found`,
      code: "NOT_FOUND",
    });
  await assertPermission(db, userId, card.workspaceId, permission);

  return card;
};

const runningSchema = z
  .object({
    publicId: z.string(),
    startedAt: z.date(),
    cardPublicId: z.string(),
    cardTitle: z.string(),
    clientName: z.string().nullable(),
    clientColourCode: z.string().nullable(),
  })
  .nullable();

const toNumber = (value: string | null) =>
  value === null ? null : Number(value);

export const timeEntryRouter = createTRPCRouter({
  running: protectedProcedure
    .meta({
      openapi: {
        summary: "Get my running timer",
        method: "GET",
        path: "/time-entries/running",
        description: "The timer the user has running, or null",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(z.void())
    .output(runningSchema)
    .query(async ({ ctx }) => {
      const userId = requireUser(ctx.user?.id);
      return timeEntryRepo.getRunning(ctx.db, userId);
    }),
  start: protectedProcedure
    .meta({
      openapi: {
        summary: "Start a timer on a card",
        method: "POST",
        path: "/cards/{cardPublicId}/time-entries/start",
        description:
          "Starts the user's timer on the card. A timer running on another card is stopped first.",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: z.string().min(12) }))
    .output(z.object({ publicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await getCard(
        ctx.db,
        userId,
        input.cardPublicId,
        "card:edit",
      );

      const entry = await timeEntryRepo.start(ctx.db, {
        userId,
        cardId: card.id,
        clientId: card.clientId,
        workspaceId: card.workspaceId,
      });

      if (!entry)
        throw new TRPCError({
          message: `Failed to start timer`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return entry;
    }),
  stop: protectedProcedure
    .meta({
      openapi: {
        summary: "Stop my running timer",
        method: "POST",
        path: "/time-entries/stop",
        description: "Stops the user's running timer, if any",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ stopped: z.boolean() }))
    .mutation(async ({ ctx }) => {
      const userId = requireUser(ctx.user?.id);
      const stopped = await timeEntryRepo.stop(ctx.db, userId);
      return { stopped };
    }),
  addManual: protectedProcedure
    .meta({
      openapi: {
        summary: "Log time on a card by hand",
        method: "POST",
        path: "/cards/{cardPublicId}/time-entries",
        description:
          "Logs time already worked: when it started and how many minutes it lasted",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        startedAt: z.coerce.date(),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .output(z.object({ publicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await getCard(
        ctx.db,
        userId,
        input.cardPublicId,
        "card:edit",
      );

      const endedAt = new Date(
        input.startedAt.getTime() + input.minutes * 60_000,
      );
      if (endedAt.getTime() > Date.now() + 60_000)
        throw new TRPCError({
          message: `Time can't be logged in the future`,
          code: "BAD_REQUEST",
        });

      const entry = await timeEntryRepo.createManual(ctx.db, {
        userId,
        cardId: card.id,
        clientId: card.clientId,
        workspaceId: card.workspaceId,
        startedAt: input.startedAt,
        endedAt,
        note: input.note || null,
      });

      if (!entry)
        throw new TRPCError({
          message: `Failed to log time`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return entry;
    }),
  forCard: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the time logged on a card",
        method: "GET",
        path: "/cards/{cardPublicId}/time-entries",
        description: "Every entry of the card, newest first, with who logged it",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: z.string().min(12) }))
    .output(
      z.array(
        z.object({
          publicId: z.string(),
          source: z.enum(["timer", "manual"]),
          startedAt: z.date(),
          endedAt: z.date().nullable(),
          note: z.string().nullable(),
          isMine: z.boolean(),
          user: z.object({
            name: z.string().nullable(),
            email: z.string(),
            image: z.string().nullable(),
          }),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await getCard(
        ctx.db,
        userId,
        input.cardPublicId,
        "card:view",
      );
      const entries = await timeEntryRepo.getAllByCardId(ctx.db, card.id);

      return entries.map((e) => ({
        publicId: e.publicId,
        source: e.source,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        note: e.note,
        isMine: e.userId === userId,
        user: { name: e.userName, email: e.userEmail, image: e.userImage },
      }));
    }),
  boardTotals: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the time logged on each card of a board",
        method: "GET",
        path: "/boards/{boardPublicId}/time-totals",
        description:
          "Total seconds per card (running timers count up to now). Cards without time are left out.",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: z.string().min(12) }))
    .output(z.array(z.object({ cardPublicId: z.string(), seconds: z.number() })))
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await boardRepo.getWorkspaceAndBoardIdByBoardPublicId(
        ctx.db,
        input.boardPublicId,
      );

      if (!board)
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, board.workspaceId, "board:view");

      return timeEntryRepo.getTotalsByBoardId(ctx.db, board.id);
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete one of my time entries",
        method: "DELETE",
        path: "/time-entries/{entryPublicId}",
        description: "Deletes a time entry. Only its owner can delete it.",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(z.object({ entryPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const entry = await timeEntryRepo.getByPublicId(
        ctx.db,
        input.entryPublicId,
      );

      if (!entry || entry.userId !== userId)
        throw new TRPCError({
          message: `Time entry with public ID ${input.entryPublicId} not found`,
          code: "NOT_FOUND",
        });

      await timeEntryRepo.softDelete(ctx.db, entry.id);

      return { success: true };
    }),
  // The Stats page. Needs "time:view"; the money fields (fee, cost,
  // currency) come back only with "finance:view", null otherwise.
  summary: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the time stats of a workspace",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/time-summary",
        description:
          "Hours by client, by person and by person × client between two dates, and the 10 cards that took longest. Fees and costs only with the finance permission.",
        tags: ["Time"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        from: z.coerce.date(),
        to: z.coerce.date(),
      }),
    )
    .output(
      z.object({
        canSeeFinance: z.boolean(),
        totalSeconds: z.number(),
        // clientPublicId null = cards without a client
        byClient: z.array(
          z.object({
            clientPublicId: z.string().nullable(),
            name: z.string().nullable(),
            colourCode: z.string().nullable(),
            contractedHours: z.number().nullable(),
            seconds: z.number(),
            monthlyFee: z.number().nullable(),
            monthlyCost: z.number().nullable(),
            feeCurrency: z.string().nullable(),
          }),
        ),
        byUser: z.array(
          z.object({
            userId: z.string(),
            name: z.string().nullable(),
            email: z.string(),
            image: z.string().nullable(),
            seconds: z.number(),
          }),
        ),
        byUserAndClient: z.array(
          z.object({
            userId: z.string(),
            clientPublicId: z.string().nullable(),
            seconds: z.number(),
          }),
        ),
        topCards: z.array(
          z.object({
            cardPublicId: z.string(),
            title: z.string(),
            clientPublicId: z.string().nullable(),
            seconds: z.number(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, workspace.id, "time:view");
      const canSeeFinance = await hasPermission(
        ctx.db,
        userId,
        workspace.id,
        "finance:view",
      );

      const summary = await timeEntryRepo.getSummary(ctx.db, {
        workspaceId: workspace.id,
        from: input.from,
        to: input.to,
      });

      const clientsById = new Map(summary.allClients.map((c) => [c.id, c]));
      const publicIdOf = (clientId: number | null) =>
        clientId === null ? null : (clientsById.get(clientId)?.publicId ?? null);
      const secondsByClient = new Map(
        summary.byClient.map((c) => [c.clientId, c.seconds]),
      );

      // Every live client that is still being worked with shows up, even
      // with no hours (it may be paying for hours nobody logged); paused,
      // lost or deleted ones only if they have hours in the period.
      const byClient = summary.allClients
        .filter(
          (c) =>
            (secondsByClient.get(c.id) ?? 0) > 0 ||
            (!c.deletedAt && c.status !== "lost" && c.status !== "paused"),
        )
        .map((c) => ({
          clientPublicId: c.publicId as string | null,
          name: c.name as string | null,
          colourCode: c.colourCode,
          contractedHours: toNumber(c.contractedHours),
          seconds: secondsByClient.get(c.id) ?? 0,
          monthlyFee: canSeeFinance ? toNumber(c.monthlyFee) : null,
          monthlyCost: canSeeFinance ? toNumber(c.monthlyCost) : null,
          feeCurrency: canSeeFinance ? c.feeCurrency : null,
        }));

      const withoutClient = secondsByClient.get(null) ?? 0;
      if (withoutClient > 0)
        byClient.push({
          clientPublicId: null,
          name: null,
          colourCode: null,
          contractedHours: null,
          seconds: withoutClient,
          monthlyFee: null,
          monthlyCost: null,
          feeCurrency: null,
        });

      return {
        canSeeFinance,
        totalSeconds: summary.byClient.reduce((acc, c) => acc + c.seconds, 0),
        byClient,
        byUser: summary.byUser,
        byUserAndClient: summary.byUserAndClient.map((r) => ({
          userId: r.userId,
          clientPublicId: publicIdOf(r.clientId),
          seconds: r.seconds,
        })),
        topCards: summary.topCards.map((c) => ({
          cardPublicId: c.cardPublicId,
          title: c.title,
          clientPublicId: publicIdOf(c.clientId),
          seconds: c.seconds,
        })),
      };
    }),
});
