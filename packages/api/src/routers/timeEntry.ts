import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as timeEntryRepo from "@kan/db/repository/timeEntry.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

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
  // Base for the future stats panel: hours by person, by client and by
  // person × client in a period, plus each client's fee and agreed hours and
  // each person's hourly cost. Profitability = fee ÷ hours worked, and
  // margin = fee − Σ(hours × hourly cost). Admins only: it shows fees.
  summary: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the time summary of a workspace",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/time-summary",
        description:
          "Hours by person and by client between two dates, with client fees and member hourly costs",
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
        byUser: z.array(
          z.object({
            userId: z.string(),
            name: z.string().nullable(),
            email: z.string(),
            hourlyCost: z.number().nullable(),
            seconds: z.number(),
          }),
        ),
        byClient: z.array(
          z.object({
            // null = cards without a client
            clientPublicId: z.string().nullable(),
            name: z.string().nullable(),
            monthlyFee: z.number().nullable(),
            feeCurrency: z.string().nullable(),
            contractedHours: z.number().nullable(),
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
      await assertPermission(ctx.db, userId, workspace.id, "workspace:manage");

      const summary = await timeEntryRepo.getSummary(ctx.db, {
        workspaceId: workspace.id,
        from: input.from,
        to: input.to,
      });

      return {
        byUser: summary.byUser.map((u) => ({
          ...u,
          hourlyCost: toNumber(u.hourlyCost),
        })),
        byClient: summary.byClient.map((c) => ({
          ...c,
          monthlyFee: toNumber(c.monthlyFee),
          contractedHours: toNumber(c.contractedHours),
        })),
        byUserAndClient: summary.byUserAndClient,
      };
    }),
});
