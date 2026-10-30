import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardFieldRepo from "@kan/db/repository/boardField.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as listRepo from "@kan/db/repository/list.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertCanEdit, assertPermission } from "../utils/permissions";

// Impeesa: board custom fields (dropdowns) and the automations that move a
// card to a list when one of its fields changes (see db/schema/boardFields.ts).

const optionSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable(),
});

const fieldSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  options: z.array(optionSchema),
});

const optionInputSchema = z.object({
  publicId: z.string().length(12).optional(),
  name: z.string().trim().min(1).max(255),
  colourCode: z.string().length(7).nullable(),
});

const automationSchema = z.object({
  publicId: z.string(),
  isActive: z.boolean(),
  field: z.object({ publicId: z.string(), name: z.string() }),
  option: optionSchema,
  list: z.object({ publicId: z.string(), name: z.string() }).nullable(),
  setField: z.object({ publicId: z.string(), name: z.string() }).nullable(),
  setOption: optionSchema.nullable(),
});

const requireUser = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

const getBoard = async (db: dbClient, boardPublicId: string) => {
  const board = await boardRepo.getWorkspaceAndBoardIdByBoardPublicId(
    db,
    boardPublicId,
  );

  if (!board)
    throw new TRPCError({
      message: `Board with public ID ${boardPublicId} not found`,
      code: "NOT_FOUND",
    });

  return board;
};

const getField = async (db: dbClient, fieldPublicId: string) => {
  const field = await boardFieldRepo.getByPublicId(db, fieldPublicId);

  if (!field)
    throw new TRPCError({
      message: `Field with public ID ${fieldPublicId} not found`,
      code: "NOT_FOUND",
    });

  return field;
};

const getAutomation = async (db: dbClient, automationPublicId: string) => {
  const automation = await boardFieldRepo.getAutomationByPublicId(
    db,
    automationPublicId,
  );

  if (!automation)
    throw new TRPCError({
      message: `Automation with public ID ${automationPublicId} not found`,
      code: "NOT_FOUND",
    });

  return automation;
};

export const boardFieldRouter = createTRPCRouter({
  all: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the custom fields of a board",
        method: "GET",
        path: "/boards/{boardPublicId}/fields",
        description: "Retrieves a board's custom fields with their options",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: z.string().min(12) }))
    .output(z.array(fieldSchema))
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:view");

      const fields = await boardFieldRepo.getAllByBoardId(ctx.db, board.id);

      return fields.map(({ publicId, name, options }) => ({
        publicId,
        name,
        options,
      }));
    }),
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a custom field",
        method: "POST",
        path: "/boards/{boardPublicId}/fields",
        description: "Creates a dropdown field on a board",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
        name: z.string().trim().min(1).max(255),
        options: z.array(optionInputSchema).min(1),
      }),
    )
    .output(z.object({ publicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:edit");

      const field = await boardFieldRepo.create(ctx.db, {
        name: input.name,
        boardId: board.id,
        createdBy: userId,
        options: input.options,
      });

      if (!field)
        throw new TRPCError({
          message: `Failed to create field`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return { publicId: field.publicId };
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a custom field",
        method: "PUT",
        path: "/fields/{fieldPublicId}",
        description:
          "Renames a field and replaces its options. Options sent with their publicId are kept; the ones left out are removed.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        fieldPublicId: z.string().length(12),
        name: z.string().trim().min(1).max(255),
        options: z.array(optionInputSchema).min(1),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const field = await getField(ctx.db, input.fieldPublicId);
      await assertPermission(
        ctx.db,
        userId,
        field.board.workspaceId,
        "board:edit",
      );

      return boardFieldRepo.update(ctx.db, {
        fieldId: field.id,
        name: input.name,
        options: input.options,
      });
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a custom field",
        method: "DELETE",
        path: "/fields/{fieldPublicId}",
        description: "Deletes a field and the automations that use it",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ fieldPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const field = await getField(ctx.db, input.fieldPublicId);
      await assertPermission(
        ctx.db,
        userId,
        field.board.workspaceId,
        "board:edit",
      );

      await boardFieldRepo.softDelete(ctx.db, field.id);

      return { success: true };
    }),
  reorder: protectedProcedure
    .meta({
      openapi: {
        summary: "Reorder the custom fields of a board",
        method: "PUT",
        path: "/boards/{boardPublicId}/fields/order",
        description: "Sets the order in which a board's fields are shown",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
        fieldPublicIds: z.array(z.string().length(12)),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:edit");

      const fields = await boardFieldRepo.getAllByBoardId(ctx.db, board.id);
      const fieldIds = input.fieldPublicIds
        .map((publicId) => fields.find((f) => f.publicId === publicId)?.id)
        .filter((id): id is number => id !== undefined);

      await boardFieldRepo.reorder(ctx.db, { boardId: board.id, fieldIds });

      return { success: true };
    }),
  forCard: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the custom fields of a card",
        method: "GET",
        path: "/cards/{cardPublicId}/fields",
        description:
          "Retrieves the fields of the card's board with the option chosen on this card. A field never set shows its first option.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: z.string().min(12) }))
    .output(
      z.array(
        fieldSchema.extend({ selectedOptionPublicId: z.string().nullable() }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await boardFieldRepo.getCardContext(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");

      const [fields, values] = await Promise.all([
        boardFieldRepo.getAllByBoardId(ctx.db, card.boardId),
        boardFieldRepo.getValuesForCardWithPublicIds(ctx.db, card.id),
      ]);

      return fields.map(({ publicId, name, options }) => {
        const stored = values.find((v) => v.fieldPublicId === publicId);
        const selected =
          options.find((o) => o.publicId === stored?.optionPublicId) ??
          options[0];

        return {
          publicId,
          name,
          options,
          selectedOptionPublicId: selected?.publicId ?? null,
        };
      });
    }),
  setValue: protectedProcedure
    .meta({
      openapi: {
        summary: "Set a custom field on a card",
        method: "PUT",
        path: "/cards/{cardPublicId}/fields/{fieldPublicId}",
        description:
          "Chooses an option of a field for a card. If an automation of the board matches the new option, the card is moved and the list is returned.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        fieldPublicId: z.string().length(12),
        optionPublicId: z.string().length(12),
      }),
    )
    .output(
      z.object({
        movedToList: z
          .object({ publicId: z.string(), name: z.string() })
          .nullable(),
        changedFields: z.array(
          z.object({ fieldName: z.string(), optionName: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const card = await boardFieldRepo.getCardContext(
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

      const field = await boardFieldRepo.getByPublicId(
        ctx.db,
        input.fieldPublicId,
      );
      const option = field?.options.find(
        (o) => o.publicId === input.optionPublicId,
      );

      // A field of another board is reported as missing.
      if (!field || field.boardId !== card.boardId || !option)
        throw new TRPCError({
          message: `Field option ${input.optionPublicId} not found`,
          code: "NOT_FOUND",
        });

      const values = await boardFieldRepo.getValuesForCard(ctx.db, card.id);
      const previousOptionId =
        values.find((v) => v.fieldId === field.id)?.optionId ??
        field.options[0]?.id;

      await boardFieldRepo.setCardValue(ctx.db, {
        cardId: card.id,
        fieldId: field.id,
        optionId: option.id,
        updatedBy: userId,
      });

      const result: {
        movedToList: { publicId: string; name: string } | null;
        changedFields: { fieldName: string; optionName: string }[];
      } = { movedToList: null, changedFields: [] };

      if (previousOptionId === option.id) return result;

      const actions = await boardFieldRepo.findMatchingAutomations(ctx.db, {
        fieldId: field.id,
        optionId: option.id,
      });

      // Only the user's own change triggers rules: a field set by a rule
      // doesn't trigger further rules, so rules can never loop.
      let currentListId = card.listId;

      for (const action of actions) {
        if (action.kind === "set") {
          await boardFieldRepo.setCardValue(ctx.db, {
            cardId: card.id,
            fieldId: action.field.id,
            optionId: action.option.id,
            updatedBy: userId,
          });
          result.changedFields.push({
            fieldName: action.field.name,
            optionName: action.option.name,
          });
        } else if (action.list.id !== currentListId) {
          await cardRepo.reorder(ctx.db, {
            cardId: card.id,
            newListId: action.list.id,
            newIndex: undefined,
          });
          await cardActivityRepo.create(ctx.db, {
            type: "card.updated.list",
            cardId: card.id,
            fromListId: currentListId,
            toListId: action.list.id,
            createdBy: userId,
          });
          currentListId = action.list.id;
          result.movedToList = {
            publicId: action.list.publicId,
            name: action.list.name,
          };
        }
      }

      return result;
    }),
  automations: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the automations of a board",
        method: "GET",
        path: "/boards/{boardPublicId}/automations",
        description: "Retrieves a board's automations",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: z.string().min(12) }))
    .output(z.array(automationSchema))
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:view");

      return boardFieldRepo.getAutomationsByBoardId(ctx.db, board.id);
    }),
  createAutomation: protectedProcedure
    .meta({
      openapi: {
        summary: "Create an automation",
        method: "POST",
        path: "/boards/{boardPublicId}/automations",
        description:
          "When the field changes to the option, either the card moves to listPublicId, or setFieldPublicId is set to setOptionPublicId. Send one of the two.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
        fieldPublicId: z.string().length(12),
        optionPublicId: z.string().length(12),
        listPublicId: z.string().min(12).optional(),
        setFieldPublicId: z.string().length(12).optional(),
        setOptionPublicId: z.string().length(12).optional(),
      }),
    )
    .output(z.object({ publicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:edit");

      const isMove = !!input.listPublicId;
      const isSet = !!input.setFieldPublicId && !!input.setOptionPublicId;

      if (isMove === isSet)
        throw new TRPCError({
          message: `Send either listPublicId, or setFieldPublicId and setOptionPublicId`,
          code: "BAD_REQUEST",
        });

      const field = await boardFieldRepo.getByPublicId(
        ctx.db,
        input.fieldPublicId,
      );
      const option = field?.options.find(
        (o) => o.publicId === input.optionPublicId,
      );

      // Everything must belong to this board.
      if (!field || field.boardId !== board.id || !option)
        throw new TRPCError({
          message: `Field or option not found on this board`,
          code: "NOT_FOUND",
        });

      let listId: number | null = null;
      let setFieldId: number | null = null;
      let setOptionId: number | null = null;

      if (input.listPublicId) {
        const list = await listRepo.getByPublicId(ctx.db, input.listPublicId);
        if (!list || list.boardId !== board.id)
          throw new TRPCError({
            message: `List not found on this board`,
            code: "NOT_FOUND",
          });
        listId = list.id;
      } else {
        const setField = await boardFieldRepo.getByPublicId(
          ctx.db,
          input.setFieldPublicId!,
        );
        const setOption = setField?.options.find(
          (o) => o.publicId === input.setOptionPublicId,
        );
        if (!setField || setField.boardId !== board.id || !setOption)
          throw new TRPCError({
            message: `Field or option to set not found on this board`,
            code: "NOT_FOUND",
          });
        if (setField.id === field.id)
          throw new TRPCError({
            message: `A rule can't change the same field that triggers it`,
            code: "BAD_REQUEST",
          });
        setFieldId = setField.id;
        setOptionId = setOption.id;
      }

      const automation = await boardFieldRepo.createAutomation(ctx.db, {
        boardId: board.id,
        fieldId: field.id,
        optionId: option.id,
        listId,
        setFieldId,
        setOptionId,
        createdBy: userId,
      });

      if (!automation)
        throw new TRPCError({
          message: `Failed to create automation`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return automation;
    }),
  updateAutomation: protectedProcedure
    .meta({
      openapi: {
        summary: "Turn an automation on or off",
        method: "PUT",
        path: "/automations/{automationPublicId}",
        description: "Turns an automation on or off",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        automationPublicId: z.string().length(12),
        isActive: z.boolean(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const automation = await getAutomation(ctx.db, input.automationPublicId);
      await assertPermission(
        ctx.db,
        userId,
        automation.field.board.workspaceId,
        "board:edit",
      );

      await boardFieldRepo.setAutomationActive(ctx.db, {
        automationId: automation.id,
        isActive: input.isActive,
      });

      return { success: true };
    }),
  deleteAutomation: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete an automation",
        method: "DELETE",
        path: "/automations/{automationPublicId}",
        description: "Deletes an automation",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ automationPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const automation = await getAutomation(ctx.db, input.automationPublicId);
      await assertPermission(
        ctx.db,
        userId,
        automation.field.board.workspaceId,
        "board:edit",
      );

      await boardFieldRepo.softDeleteAutomation(ctx.db, automation.id);

      return { success: true };
    }),
});
