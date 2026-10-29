import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as clientRepo from "@kan/db/repository/client.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertCanEdit, assertPermission } from "../utils/permissions";

// Impeesa: workspace-wide clients, one per card (see db/schema/clients.ts).

const clientSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable(),
});

export const clientRouter = createTRPCRouter({
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
        description: "Creates a new client in a workspace",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        name: z.string().trim().min(1).max(60),
        colourCode: z.string().length(7),
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
        colourCode: input.colourCode,
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
        description: "Renames or recolours a client",
        tags: ["Clients"],
        protect: true,
      },
    })
    .input(
      z.object({
        clientPublicId: z.string().min(12),
        name: z.string().trim().min(1).max(60),
        colourCode: z.string().length(7),
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
        { name: input.name, colourCode: input.colourCode },
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
});
