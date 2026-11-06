import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as cardLinkRepo from "@kan/db/repository/cardLink.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertCanEdit, assertPermission } from "../utils/permissions";
import { webUrlSchema } from "./client";

// Impeesa: links to Drive files and folders on a card, plus the Drive folder
// of the card's client (see db/schema/cardLinks.ts).

const linkSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  url: z.string(),
});

const requireUser = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

const getCard = async (db: dbClient, cardPublicId: string) => {
  const card = await cardLinkRepo.getCardWithClientFolder(db, cardPublicId);

  if (!card)
    throw new TRPCError({
      message: `Card with public ID ${cardPublicId} not found`,
      code: "NOT_FOUND",
    });

  return card;
};

export const cardLinkRouter = createTRPCRouter({
  forCard: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the links of a card",
        method: "GET",
        path: "/cards/{cardPublicId}/links",
        description:
          "Retrieves the card's links and the Drive folder of its client, if any",
        tags: ["Links"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: z.string().min(12) }))
    .output(
      z.object({
        clientFolder: z
          .object({ name: z.string(), driveUrl: z.string() })
          .nullable(),
        links: z.array(linkSchema),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await getCard(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");

      const links = await cardLinkRepo.getAllByCardId(ctx.db, card.id);

      return { clientFolder: card.clientFolder, links };
    }),
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Add a link to a card",
        method: "POST",
        path: "/cards/{cardPublicId}/links",
        description: "Adds a link to a Drive file or folder (or any web page)",
        tags: ["Links"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        title: z.string().trim().min(1).max(255),
        url: webUrlSchema,
      }),
    )
    .output(linkSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await getCard(ctx.db, input.cardPublicId);
      await assertCanEdit(
        ctx.db,
        userId,
        card.workspaceId,
        "card:edit",
        card.createdBy,
      );

      const link = await cardLinkRepo.create(ctx.db, {
        cardId: card.id,
        title: input.title,
        url: input.url,
        createdBy: userId,
      });

      if (!link)
        throw new TRPCError({
          message: `Failed to add link`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return link;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Remove a link from a card",
        method: "DELETE",
        path: "/links/{linkPublicId}",
        description:
          "Removes a link from its card. Nothing is deleted in Drive.",
        tags: ["Links"],
        protect: true,
      },
    })
    .input(z.object({ linkPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const link = await cardLinkRepo.getByPublicId(ctx.db, input.linkPublicId);

      if (!link)
        throw new TRPCError({
          message: `Link with public ID ${input.linkPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanEdit(
        ctx.db,
        userId,
        link.workspaceId,
        "card:edit",
        link.cardCreatedBy,
      );

      await cardLinkRepo.softDelete(ctx.db, link.id);

      return { success: true };
    }),
});
