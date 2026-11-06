import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardFieldRepo from "@kan/db/repository/boardField.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as memberRepo from "@kan/db/repository/member.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertCanEdit, assertPermission } from "../utils/permissions";
import { sendPush } from "../utils/push";

// Impeesa: board custom fields (dropdowns) and the automations that move a
// card to a list when one of its fields changes (see db/schema/boardFields.ts).

const optionSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable(),
  isDone: z.boolean(),
});

// Automations only need to show an option, not whether it finishes a field.
const optionLabelSchema = optionSchema.omit({ isDone: true });

const fieldSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  isOptional: z.boolean(),
  options: z.array(optionSchema),
});

const optionInputSchema = z.object({
  publicId: z.string().length(12).optional(),
  name: z.string().trim().min(1).max(255),
  colourCode: z.string().length(7).nullable(),
  isDone: z.boolean().default(false),
});

const automationSchema = z.object({
  publicId: z.string(),
  isActive: z.boolean(),
  field: z.object({ publicId: z.string(), name: z.string() }),
  option: optionLabelSchema,
  list: z.object({ publicId: z.string(), name: z.string() }).nullable(),
  setField: z.object({ publicId: z.string(), name: z.string() }).nullable(),
  setOption: optionLabelSchema.nullable(),
  notifyField: z.object({ publicId: z.string(), name: z.string() }).nullable(),
});

// The person in charge of a field on a card.
const assigneeSchema = z.object({
  memberPublicId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const toAssignee = (row: {
  memberPublicId: string;
  email: string;
  name: string | null;
  image: string | null;
}) => ({
  memberPublicId: row.memberPublicId,
  email: row.email,
  name: row.name,
  image: row.image,
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

      return fields.map(({ publicId, name, isOptional, options }) => ({
        publicId,
        name,
        isOptional,
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
        isOptional: z.boolean().default(false),
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
        isOptional: input.isOptional,
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
        isOptional: z.boolean().default(false),
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
        isOptional: input.isOptional,
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
          "Retrieves the fields of the card's board with the option chosen on this card (null while the field is empty) and the person in charge of each field (null when nobody is).",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: z.string().min(12) }))
    .output(
      z.array(
        fieldSchema.extend({
          selectedOptionPublicId: z.string().nullable(),
          assignee: assigneeSchema.nullable(),
        }),
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

      const [fields, values, assignees] = await Promise.all([
        boardFieldRepo.getAllByBoardId(ctx.db, card.boardId),
        boardFieldRepo.getValuesForCardWithPublicIds(ctx.db, card.id),
        boardFieldRepo.getAssigneesForCard(ctx.db, card.id),
      ]);

      return fields.map(({ publicId, name, isOptional, options }) => {
        const stored = values.find((v) => v.fieldPublicId === publicId);
        const selected = options.find(
          (o) => o.publicId === stored?.optionPublicId,
        );
        const assignee = assignees.find((a) => a.fieldPublicId === publicId);

        return {
          publicId,
          name,
          isOptional,
          options,
          selectedOptionPublicId: selected?.publicId ?? null,
          assignee: assignee ? toAssignee(assignee) : null,
        };
      });
    }),
  setAssignee: protectedProcedure
    .meta({
      openapi: {
        summary: "Set who is in charge of a field on a card",
        method: "PUT",
        path: "/cards/{cardPublicId}/fields/{fieldPublicId}/assignee",
        description:
          "Chooses the workspace member in charge of this field (step) on the card, or nobody with a null memberPublicId. Automations can notify them.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        fieldPublicId: z.string().length(12),
        memberPublicId: z.string().length(12).nullable(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
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
      if (!field || field.boardId !== card.boardId)
        throw new TRPCError({
          message: `Field with public ID ${input.fieldPublicId} not found`,
          code: "NOT_FOUND",
        });

      if (input.memberPublicId === null) {
        await boardFieldRepo.clearCardAssignee(ctx.db, {
          cardId: card.id,
          fieldId: field.id,
        });
        return { success: true };
      }

      const member = await memberRepo.getByPublicId(
        ctx.db,
        input.memberPublicId,
      );
      // Only members of the card's own workspace can be put in charge.
      if (
        !member ||
        member.workspaceId !== card.workspaceId ||
        member.deletedAt
      )
        throw new TRPCError({
          message: `Member with public ID ${input.memberPublicId} not found`,
          code: "NOT_FOUND",
        });

      await boardFieldRepo.setCardAssignee(ctx.db, {
        cardId: card.id,
        fieldId: field.id,
        workspaceMemberId: member.id,
        updatedBy: userId,
      });

      return { success: true };
    }),
  setValue: protectedProcedure
    .meta({
      openapi: {
        summary: "Set a custom field on a card",
        method: "PUT",
        path: "/cards/{cardPublicId}/fields/{fieldPublicId}",
        description:
          "Chooses an option of a field for a card, or empties the field with a null optionPublicId. The board's automations for the new option run and their changes are returned.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        fieldPublicId: z.string().length(12),
        optionPublicId: z.string().length(12).nullable(),
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
        // Fields whose person in charge was sent a notification.
        notifiedFields: z.array(z.string()),
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
      if (
        !field ||
        field.boardId !== card.boardId ||
        (input.optionPublicId !== null && !option)
      )
        throw new TRPCError({
          message: `Field option ${input.optionPublicId} not found`,
          code: "NOT_FOUND",
        });

      const result: {
        movedToList: { publicId: string; name: string } | null;
        changedFields: { fieldName: string; optionName: string }[];
        notifiedFields: string[];
      } = { movedToList: null, changedFields: [], notifiedFields: [] };

      if (!option) {
        await boardFieldRepo.clearCardValue(ctx.db, {
          cardId: card.id,
          fieldId: field.id,
        });
        return result;
      }

      const values = await boardFieldRepo.getValuesForCard(ctx.db, card.id);
      const previousOptionId = values.find(
        (v) => v.fieldId === field.id,
      )?.optionId;

      await boardFieldRepo.setCardValue(ctx.db, {
        cardId: card.id,
        fieldId: field.id,
        optionId: option.id,
        updatedBy: userId,
      });

      if (previousOptionId === option.id) return result;

      const actions = await boardFieldRepo.findMatchingAutomations(ctx.db, {
        fieldId: field.id,
        optionId: option.id,
      });

      // Only the user's own change triggers rules: a field set by a rule
      // doesn't trigger further rules, so rules can never loop.
      let currentListId = card.listId;
      const notifyUserIds = new Set<string>();

      for (const action of actions) {
        if (action.kind === "notify") {
          const assigneeUserId = await boardFieldRepo.getAssigneeUserId(
            ctx.db,
            { cardId: card.id, fieldId: action.field.id },
          );
          // Nobody in charge, or it's the person making the change: no one
          // to tell.
          if (assigneeUserId && assigneeUserId !== userId) {
            notifyUserIds.add(assigneeUserId);
            result.notifiedFields.push(action.field.name);
          }
        } else if (action.kind === "set") {
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

      if (notifyUserIds.size > 0) {
        const by = ctx.user?.name?.trim();
        await sendPush(ctx.db, [...notifyUserIds], {
          title: `${field.name} → ${option.name}`,
          body: `${card.title} · ${card.boardName}${by ? ` (${by})` : ""}`,
          url: `/cards/${input.cardPublicId}`,
          tag: `${input.cardPublicId}-${field.publicId}`,
        });
      }

      return result;
    }),
  boardValues: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the custom field values of a board's cards",
        method: "GET",
        path: "/boards/{boardPublicId}/field-values",
        description:
          "Retrieves the board's fields and, for every card, the option chosen in each field. Empty fields are left out.",
        tags: ["Fields"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: z.string().min(12) }))
    .output(
      z.object({
        fields: z.array(fieldSchema),
        values: z.array(
          z.object({
            cardPublicId: z.string(),
            fieldPublicId: z.string(),
            optionPublicId: z.string(),
          }),
        ),
        assignees: z.array(
          assigneeSchema.extend({
            cardPublicId: z.string(),
            fieldPublicId: z.string(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:view");

      const [fields, values, assignees] = await Promise.all([
        boardFieldRepo.getAllByBoardId(ctx.db, board.id),
        boardFieldRepo.getValuesForBoard(ctx.db, board.id),
        boardFieldRepo.getAssigneesForBoard(ctx.db, board.id),
      ]);

      return {
        fields: fields.map(({ publicId, name, isOptional, options }) => ({
          publicId,
          name,
          isOptional,
          options,
        })),
        values,
        assignees: assignees.map((a) => ({
          cardPublicId: a.cardPublicId,
          fieldPublicId: a.fieldPublicId,
          ...toAssignee(a),
        })),
      };
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
          "When the field changes to the option, either the card moves to listPublicId, setFieldPublicId is set to setOptionPublicId, or the person in charge of notifyFieldPublicId on that card gets a notification. Send one of the three.",
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
        notifyFieldPublicId: z.string().length(12).optional(),
      }),
    )
    .output(z.object({ publicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      const board = await getBoard(ctx.db, input.boardPublicId);
      await assertPermission(ctx.db, userId, board.workspaceId, "board:edit");

      const isMove = !!input.listPublicId;
      const isSet = !!input.setFieldPublicId && !!input.setOptionPublicId;
      const isNotify = !!input.notifyFieldPublicId;

      if ([isMove, isSet, isNotify].filter(Boolean).length !== 1)
        throw new TRPCError({
          message: `Send either listPublicId, setFieldPublicId and setOptionPublicId, or notifyFieldPublicId`,
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
      let notifyFieldId: number | null = null;

      if (input.notifyFieldPublicId) {
        // Notifying the person in charge of the trigger field itself is
        // allowed (e.g. Diseño → Modificaciones tells the designer).
        const notifyField = await boardFieldRepo.getByPublicId(
          ctx.db,
          input.notifyFieldPublicId,
        );
        if (!notifyField || notifyField.boardId !== board.id)
          throw new TRPCError({
            message: `Field to notify not found on this board`,
            code: "NOT_FOUND",
          });
        notifyFieldId = notifyField.id;
      } else if (input.listPublicId) {
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
        notifyFieldId,
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
