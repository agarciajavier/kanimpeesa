import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as clientRepo from "@kan/db/repository/client.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { clientStatuses, clientTypes } from "@kan/shared/constants";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertCanEdit, assertPermission } from "../utils/permissions";

// Impeesa: workspace-wide clients, one per card (see db/schema/clients.ts).

// Only web links: a "javascript:" URL would run code when clicked.
export const webUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "Must be an http(s) link");

const clientSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable(),
  status: z.enum(clientStatuses),
  type: z.enum(clientTypes).nullable(),
  driveUrl: z.string().nullable(),
  briefUrl: z.string().nullable(),
  summary: z.string().nullable(),
});

const summarySchema = z.string().trim().max(2000);

// Impeesa: currencies a fee can be in.
export const feeCurrencies = ["ARS", "USD"] as const;
const moneySchema = z.number().min(0).max(999_999_999_999).nullable();
const financesSchema = z.object({
  clientPublicId: z.string().min(12),
  monthlyFee: moneySchema,
  monthlyCost: moneySchema,
  feeCurrency: z.enum(feeCurrencies),
  contractedHours: z.number().min(0).max(9999).nullable(),
});

export const clientRouter = createTRPCRouter({
  overview: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the clients of a workspace with their task count",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/clients/overview",
        description:
          "Retrieves every client with its folder, brief, summary and how many tasks it has",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: z.string().min(12) }))
    .output(z.array(clientSchema.extend({ taskCount: z.number() })))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, workspace.id, "board:view");

      const [clients, ids] = await Promise.all([
        clientRepo.getAllByWorkspaceId(ctx.db, workspace.id),
        clientRepo.getIdsByWorkspaceId(ctx.db, workspace.id),
      ]);
      const counts = await clientRepo.getCardCounts(
        ctx.db,
        ids.map((c) => c.id),
      );

      return clients.map((client) => {
        const id = ids.find((c) => c.publicId === client.publicId)?.id;
        return {
          ...client,
          taskCount: counts.find((c) => c.clientId === id)?.total ?? 0,
        };
      });
    }),
  all: protectedProcedure
    .meta({
      openapi: {
        summary: "Get all clients for a workspace",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/clients",
        description: "Retrieves all clients of a workspace, sorted by name",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: z.string().min(12) }))
    .output(z.array(clientSchema))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, workspace.id, "board:view");

      return clientRepo.getAllByWorkspaceId(ctx.db, workspace.id);
    }),
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a client",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/clients",
        description:
          "Creates a new client in a workspace, optionally with its Google Drive folder (driveUrl), the link to its brief (briefUrl) and a short summary",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        name: z.string().trim().min(1).max(60),
        status: z.enum(clientStatuses).default("starting"),
        type: z
          .enum(clientTypes)
          .nullish()
          .describe("management = Gestión, advisory = Asesoría"),
        driveUrl: webUrlSchema.nullish(),
        briefUrl: webUrlSchema.nullish(),
        summary: summarySchema.nullish(),
      }),
    )
    .output(clientSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, workspace.id, "board:edit");

      const result = await clientRepo.create(ctx.db, {
        name: input.name,
        status: input.status,
        type: input.type ?? null,
        driveUrl: input.driveUrl ?? null,
        briefUrl: input.briefUrl ?? null,
        summary: input.summary || null,
        workspaceId: workspace.id,
        createdBy: userId,
      });

      if (!result)
        throw new TRPCError({
          message: `Failed to create client`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return result;
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a client",
        method: "PUT",
        path: "/clients/{clientPublicId}",
        description:
          "Renames a client or changes its status, Drive folder, brief or summary (null removes a value, left out keeps it)",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(
      z.object({
        clientPublicId: z.string().min(12),
        name: z.string().trim().min(1).max(60),
        status: z.enum(clientStatuses),
        type: z
          .enum(clientTypes)
          .nullish()
          .describe("management = Gestión, advisory = Asesoría"),
        driveUrl: webUrlSchema.nullish(),
        briefUrl: webUrlSchema.nullish(),
        summary: summarySchema.nullish(),
      }),
    )
    .output(clientSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const client = await clientRepo.getByPublicId(
        ctx.db,
        input.clientPublicId,
      );

      if (!client)
        throw new TRPCError({
          message: `Client with public ID ${input.clientPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, client.workspaceId, "board:edit");

      const result = await clientRepo.update(
        ctx.db,
        {
          name: input.name,
          status: input.status,
          type: input.type,
          driveUrl: input.driveUrl,
          briefUrl: input.briefUrl,
          summary:
            input.summary === undefined ? undefined : input.summary || null,
        },
        { clientPublicId: input.clientPublicId },
      );

      if (!result)
        throw new TRPCError({
          message: `Failed to update client`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return result;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a client",
        method: "DELETE",
        path: "/clients/{clientPublicId}",
        description:
          "Deletes a client and removes it from every card it was assigned to",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(z.object({ clientPublicId: z.string().min(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const client = await clientRepo.getByPublicId(
        ctx.db,
        input.clientPublicId,
      );

      if (!client)
        throw new TRPCError({
          message: `Client with public ID ${input.clientPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, client.workspaceId, "board:edit");

      await clientRepo.softDelete(ctx.db, {
        clientId: client.id,
        deletedBy: userId,
      });

      return { success: true };
    }),
  setForCard: protectedProcedure
    .meta({
      openapi: {
        summary: "Set the client of a card",
        method: "PUT",
        path: "/cards/{cardPublicId}/client",
        description:
          "Assigns a client to a card, or removes it when clientPublicId is null",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        clientPublicId: z.string().min(12).nullable(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertCanEdit(
        ctx.db,
        userId,
        card.workspaceId,
        "card:edit",
        card.createdBy,
      );

      let clientId: number | null = null;

      if (input.clientPublicId) {
        const client = await clientRepo.getByPublicId(
          ctx.db,
          input.clientPublicId,
        );

        // A client from another workspace is reported as missing, not as
        // forbidden, so its existence doesn't leak.
        if (!client || client.workspaceId !== card.workspaceId)
          throw new TRPCError({
            message: `Client with public ID ${input.clientPublicId} not found`,
            code: "NOT_FOUND",
          });

        clientId = client.id;
      }

      await clientRepo.setCardClient(ctx.db, { cardId: card.id, clientId });

      return { success: true };
    }),
  // Impeesa: fee, cost and agreed hours of each client, for the Stats page.
  // Only with "finance:view".
  finances: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the fees and costs of the clients",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/clients/finances",
        description:
          "Monthly fee, monthly cost, currency and agreed monthly hours of every client",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: z.string().min(12) }))
    .output(z.array(financesSchema))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, workspace.id, "finance:view");

      const rows = await clientRepo.getFinancesByWorkspaceId(
        ctx.db,
        workspace.id,
      );
      const toNumber = (v: string | null) => (v === null ? null : Number(v));

      return rows.map((r) => ({
        clientPublicId: r.publicId,
        monthlyFee: toNumber(r.monthlyFee),
        monthlyCost: toNumber(r.monthlyCost),
        feeCurrency: r.feeCurrency as (typeof feeCurrencies)[number],
        contractedHours: toNumber(r.contractedHours),
      }));
    }),
  updateFinances: protectedProcedure
    .meta({
      openapi: {
        summary: "Set the fee and cost of a client",
        method: "PUT",
        path: "/clients/{clientPublicId}/finances",
        description:
          "Sets the monthly fee, monthly cost, currency and agreed monthly hours. null clears a value.",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(financesSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const client = await clientRepo.getByPublicId(
        ctx.db,
        input.clientPublicId,
      );

      if (!client)
        throw new TRPCError({
          message: `Client with public ID ${input.clientPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, client.workspaceId, "finance:view");

      await clientRepo.updateFinances(ctx.db, client.id, input);

      return { success: true };
    }),
});
