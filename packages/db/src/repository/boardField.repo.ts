import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boardAutomations,
  boardFieldOptions,
  boardFields,
  cardFieldValues,
  cards,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

// Impeesa: board custom fields and their automations
// (see schema/boardFields.ts).

export interface FieldOptionInput {
  publicId?: string;
  name: string;
  colourCode: string | null;
}

export const getAllByBoardId = (db: dbClient, boardId: number) => {
  return db.query.boardFields.findMany({
    columns: { id: true, publicId: true, name: true, index: true },
    where: and(eq(boardFields.boardId, boardId), isNull(boardFields.deletedAt)),
    orderBy: [asc(boardFields.index), asc(boardFields.id)],
    with: {
      options: {
        columns: { publicId: true, name: true, colourCode: true },
        where: isNull(boardFieldOptions.deletedAt),
        orderBy: [asc(boardFieldOptions.index), asc(boardFieldOptions.id)],
      },
    },
  });
};

export const getByPublicId = (db: dbClient, fieldPublicId: string) => {
  return db.query.boardFields.findFirst({
    columns: { id: true, publicId: true, name: true, boardId: true },
    where: and(
      eq(boardFields.publicId, fieldPublicId),
      isNull(boardFields.deletedAt),
    ),
    with: {
      board: { columns: { workspaceId: true } },
      options: {
        columns: { id: true, publicId: true, name: true, colourCode: true },
        where: isNull(boardFieldOptions.deletedAt),
        orderBy: [asc(boardFieldOptions.index), asc(boardFieldOptions.id)],
      },
    },
  });
};

export const create = async (
  db: dbClient,
  input: {
    name: string;
    boardId: number;
    createdBy: string;
    options: FieldOptionInput[];
  },
) => {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: boardFields.id })
      .from(boardFields)
      .where(
        and(
          eq(boardFields.boardId, input.boardId),
          isNull(boardFields.deletedAt),
        ),
      );

    const [field] = await tx
      .insert(boardFields)
      .values({
        publicId: generateUID(),
        name: input.name,
        boardId: input.boardId,
        index: existing.length,
        createdBy: input.createdBy,
      })
      .returning({ id: boardFields.id, publicId: boardFields.publicId });

    if (!field) return undefined;

    if (input.options.length > 0)
      await tx.insert(boardFieldOptions).values(
        input.options.map((option, index) => ({
          publicId: generateUID(),
          name: option.name,
          colourCode: option.colourCode,
          index,
          fieldId: field.id,
        })),
      );

    return field;
  });
};

// Options that keep their publicId are updated in place, so the values cards
// already hold and the automations that use them survive a rename. Options
// left out are removed, together with the card values and automations that
// pointed at them.
export const update = async (
  db: dbClient,
  input: { fieldId: number; name: string; options: FieldOptionInput[] },
) => {
  return db.transaction(async (tx) => {
    await tx
      .update(boardFields)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(boardFields.id, input.fieldId));

    const current = await tx
      .select({
        id: boardFieldOptions.id,
        publicId: boardFieldOptions.publicId,
      })
      .from(boardFieldOptions)
      .where(
        and(
          eq(boardFieldOptions.fieldId, input.fieldId),
          isNull(boardFieldOptions.deletedAt),
        ),
      );

    const keptIds: number[] = [];

    for (const [index, option] of input.options.entries()) {
      const match = current.find((c) => c.publicId === option.publicId);

      if (match) {
        keptIds.push(match.id);
        await tx
          .update(boardFieldOptions)
          .set({ name: option.name, colourCode: option.colourCode, index })
          .where(eq(boardFieldOptions.id, match.id));
      } else {
        const [created] = await tx
          .insert(boardFieldOptions)
          .values({
            publicId: generateUID(),
            name: option.name,
            colourCode: option.colourCode,
            index,
            fieldId: input.fieldId,
          })
          .returning({ id: boardFieldOptions.id });
        if (created) keptIds.push(created.id);
      }
    }

    const removedIds = current
      .map((c) => c.id)
      .filter((id) => !keptIds.includes(id));

    if (removedIds.length > 0) {
      await tx
        .update(boardFieldOptions)
        .set({ deletedAt: new Date() })
        .where(inArray(boardFieldOptions.id, removedIds));
      await tx
        .delete(cardFieldValues)
        .where(inArray(cardFieldValues.optionId, removedIds));
      await tx
        .update(boardAutomations)
        .set({ deletedAt: new Date() })
        .where(inArray(boardAutomations.optionId, removedIds));
    }

    return { success: true };
  });
};

export const softDelete = async (db: dbClient, fieldId: number) => {
  return db.transaction(async (tx) => {
    await tx
      .update(boardFields)
      .set({ deletedAt: new Date() })
      .where(eq(boardFields.id, fieldId));
    await tx
      .update(boardAutomations)
      .set({ deletedAt: new Date() })
      .where(eq(boardAutomations.fieldId, fieldId));
  });
};

// fieldIds come in their new order; fields of the board not listed keep
// their place after them.
export const reorder = async (
  db: dbClient,
  input: { boardId: number; fieldIds: number[] },
) => {
  return db.transaction(async (tx) => {
    for (const [index, id] of input.fieldIds.entries()) {
      await tx
        .update(boardFields)
        .set({ index })
        .where(
          and(eq(boardFields.id, id), eq(boardFields.boardId, input.boardId)),
        );
    }
    if (input.fieldIds.length > 0)
      await tx
        .update(boardFields)
        .set({ index: input.fieldIds.length })
        .where(
          and(
            eq(boardFields.boardId, input.boardId),
            notInArray(boardFields.id, input.fieldIds),
          ),
        );
  });
};

export const getCardContext = async (db: dbClient, cardPublicId: string) => {
  const card = await db.query.cards.findFirst({
    columns: { id: true, listId: true, createdBy: true },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
    with: {
      list: {
        columns: { boardId: true },
        with: { board: { columns: { workspaceId: true } } },
      },
    },
  });

  return card
    ? {
        id: card.id,
        listId: card.listId,
        createdBy: card.createdBy,
        boardId: card.list.boardId,
        workspaceId: card.list.board.workspaceId,
      }
    : null;
};

export const getValuesForCard = (db: dbClient, cardId: number) => {
  return db
    .select({
      fieldId: cardFieldValues.fieldId,
      optionId: cardFieldValues.optionId,
    })
    .from(cardFieldValues)
    .where(eq(cardFieldValues.cardId, cardId));
};

export const getValuesForCardWithPublicIds = (db: dbClient, cardId: number) => {
  return db
    .select({
      fieldPublicId: boardFields.publicId,
      optionPublicId: boardFieldOptions.publicId,
    })
    .from(cardFieldValues)
    .innerJoin(boardFields, eq(boardFields.id, cardFieldValues.fieldId))
    .innerJoin(
      boardFieldOptions,
      eq(boardFieldOptions.id, cardFieldValues.optionId),
    )
    .where(eq(cardFieldValues.cardId, cardId));
};

export const getValuesForCards = async (db: dbClient, cardIds: number[]) => {
  if (cardIds.length === 0) return [];

  return db
    .select({
      cardId: cardFieldValues.cardId,
      fieldId: cardFieldValues.fieldId,
      optionId: cardFieldValues.optionId,
    })
    .from(cardFieldValues)
    .where(inArray(cardFieldValues.cardId, cardIds));
};

export const setCardValue = async (
  db: dbClient,
  input: {
    cardId: number;
    fieldId: number;
    optionId: number;
    updatedBy: string;
  },
) => {
  await db
    .insert(cardFieldValues)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [cardFieldValues.cardId, cardFieldValues.fieldId],
      set: {
        optionId: input.optionId,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    });
};

export const getAutomationsByBoardId = async (
  db: dbClient,
  boardId: number,
) => {
  const rows = await db.query.boardAutomations.findMany({
    columns: { publicId: true, isActive: true },
    where: and(
      eq(boardAutomations.boardId, boardId),
      isNull(boardAutomations.deletedAt),
    ),
    orderBy: [asc(boardAutomations.id)],
    with: {
      field: { columns: { publicId: true, name: true, deletedAt: true } },
      option: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
          deletedAt: true,
        },
      },
      list: { columns: { publicId: true, name: true, deletedAt: true } },
    },
  });

  // A rule whose list was deleted has nowhere to send cards, so it's hidden.
  return rows
    .filter(
      (r) => !r.field.deletedAt && !r.option.deletedAt && !r.list.deletedAt,
    )
    .map((r) => ({
      publicId: r.publicId,
      isActive: r.isActive,
      field: { publicId: r.field.publicId, name: r.field.name },
      option: {
        publicId: r.option.publicId,
        name: r.option.name,
        colourCode: r.option.colourCode,
      },
      list: { publicId: r.list.publicId, name: r.list.name },
    }));
};

export const getAutomationByPublicId = (
  db: dbClient,
  automationPublicId: string,
) => {
  return db.query.boardAutomations.findFirst({
    columns: { id: true, boardId: true },
    with: { field: { with: { board: { columns: { workspaceId: true } } } } },
    where: and(
      eq(boardAutomations.publicId, automationPublicId),
      isNull(boardAutomations.deletedAt),
    ),
  });
};

export const createAutomation = async (
  db: dbClient,
  input: {
    boardId: number;
    fieldId: number;
    optionId: number;
    listId: number;
    createdBy: string;
  },
) => {
  const [automation] = await db
    .insert(boardAutomations)
    .values({ publicId: generateUID(), ...input })
    .returning({ publicId: boardAutomations.publicId });

  return automation;
};

export const setAutomationActive = (
  db: dbClient,
  input: { automationId: number; isActive: boolean },
) => {
  return db
    .update(boardAutomations)
    .set({ isActive: input.isActive })
    .where(eq(boardAutomations.id, input.automationId));
};

export const softDeleteAutomation = (db: dbClient, automationId: number) => {
  return db
    .update(boardAutomations)
    .set({ deletedAt: new Date() })
    .where(eq(boardAutomations.id, automationId));
};

// The oldest active rule wins when several match the same option.
export const findMatchingAutomation = async (
  db: dbClient,
  input: { fieldId: number; optionId: number },
) => {
  const rows = await db.query.boardAutomations.findMany({
    columns: { id: true },
    where: and(
      eq(boardAutomations.fieldId, input.fieldId),
      eq(boardAutomations.optionId, input.optionId),
      eq(boardAutomations.isActive, true),
      isNull(boardAutomations.deletedAt),
    ),
    orderBy: [asc(boardAutomations.id)],
    with: {
      list: {
        columns: { id: true, publicId: true, name: true, deletedAt: true },
      },
    },
  });

  return rows.find((r) => !r.list.deletedAt)?.list ?? null;
};
