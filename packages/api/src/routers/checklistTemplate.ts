import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import * as checklistTemplateRepo from "@kan/db/repository/checklistTemplate.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

// Impeesa: reusable checklists (see db/schema/checklistTemplates.ts).

const templateSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  items: z.array(z.string()),
});

export const checklistTemplateRouter = createTRPCRouter({
  all: protectedProcedure
    .meta({
      openapi: {
        summary: "Get all checklist templates for a workspace",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/checklist-templates",
        description: "Retrieves the checklist templates of a workspace",
        tags: ["Checklist templates"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: z.string().min(12) }))
    .output(z.array(templateSchema))
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

      return checklistTemplateRepo.getAllByWorkspaceId(ctx.db, workspace.id);
    }),
  saveFromChecklist: protectedProcedure
    .meta({
      openapi: {
        summary: "Save a checklist as a template",
        method: "POST",
        path: "/checklists/{checklistPublicId}/template",
        description:
          "Saves a checklist's items as a template named like the checklist. An existing template with that name is replaced.",
        tags: ["Checklist templates"],
        protect: true,
      },
    })
    .input(z.object({ checklistPublicId: z.string().length(12) }))
    .output(templateSchema.extend({ replaced: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );

      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });

      const workspaceId = checklist.card.list.board.workspace.id;
      await assertPermission(ctx.db, userId, workspaceId, "card:edit");

      const items = await checklistTemplateRepo.getChecklistItemTitles(
        ctx.db,
        checklist.id,
      );

      const result = await checklistTemplateRepo.saveByName(ctx.db, {
        name: checklist.name,
        items,
        workspaceId,
        createdBy: userId,
      });

      if (!result)
        throw new TRPCError({
          message: `Failed to save checklist template`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return result;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a checklist template",
        method: "DELETE",
        path: "/checklist-templates/{templatePublicId}",
        description:
          "Deletes a checklist template. Checklists created from it stay as they are.",
        tags: ["Checklist templates"],
        protect: true,
      },
    })
    .input(z.object({ templatePublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const template = await checklistTemplateRepo.getByPublicId(
        ctx.db,
        input.templatePublicId,
      );

      if (!template)
        throw new TRPCError({
          message: `Checklist template with public ID ${input.templatePublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, template.workspaceId, "card:edit");

      await checklistTemplateRepo.softDelete(ctx.db, template.id);

      return { success: true };
    }),
  apply: protectedProcedure
    .meta({
      openapi: {
        summary: "Add a checklist from a template",
        method: "POST",
        path: "/cards/{cardPublicId}/checklists/from-template",
        description:
          "Adds a new checklist to a card with the template's name and items",
        tags: ["Checklist templates"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        templatePublicId: z.string().length(12),
      }),
    )
    .output(z.object({ publicId: z.string(), name: z.string() }))
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
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");

      const template = await checklistTemplateRepo.getByPublicId(
        ctx.db,
        input.templatePublicId,
      );

      // A template from another workspace is reported as missing, so its
      // existence doesn't leak.
      if (!template || template.workspaceId !== card.workspaceId)
        throw new TRPCError({
          message: `Checklist template with public ID ${input.templatePublicId} not found`,
          code: "NOT_FOUND",
        });

      const newChecklist = await checklistRepo.create(ctx.db, {
        name: template.name,
        createdBy: userId,
        cardId: card.id,
      });

      if (!newChecklist?.id)
        throw new TRPCError({
          message: `Failed to create checklist`,
          code: "INTERNAL_SERVER_ERROR",
        });

      await checklistRepo.bulkCreateItems(
        ctx.db,
        template.items.map((title, index) => ({
          checklistId: newChecklist.id,
          title,
          createdBy: userId,
          index,
          completed: false,
        })),
      );

      await cardActivityRepo.create(ctx.db, {
        type: "card.updated.checklist.added",
        cardId: card.id,
        toTitle: newChecklist.name,
        createdBy: userId,
      });

      return { publicId: newChecklist.publicId, name: newChecklist.name };
    }),
});
