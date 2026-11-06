import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { ClientStatus } from "@kan/shared/constants";
import { boards, cards, clients, lists } from "@kan/db/schema";
import { clientStatusDetails } from "@kan/shared/constants";
import { generateUID } from "@kan/shared/utils";

// Impeesa: clients are workspace-wide (see schema/clients.ts).

export const getAllByWorkspaceId = (db: dbClient, workspaceId: number) => {
  return db.query.clients.findMany({
    columns: {
      publicId: true,
      name: true,
      colourCode: true,
      status: true,
      driveUrl: true,
      briefUrl: true,
      summary: true,
    },
    where: and(eq(clients.workspaceId, workspaceId), isNull(clients.deletedAt)),
    orderBy: [asc(clients.name)],
  });
};

// Cards of each client still on a live board (deleted cards, lists and
// boards don't count).
export const getCardCounts = async (db: dbClient, clientIds: number[]) => {
  if (clientIds.length === 0) return [];

  return db
    .select({ clientId: cards.clientId, total: count() })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .where(
      and(
        inArray(cards.clientId, clientIds),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
      ),
    )
    .groupBy(cards.clientId);
};

export const getIdsByWorkspaceId = (db: dbClient, workspaceId: number) => {
  return db
    .select({ id: clients.id, publicId: clients.publicId })
    .from(clients)
    .where(
      and(eq(clients.workspaceId, workspaceId), isNull(clients.deletedAt)),
    );
};

export const getByPublicId = (db: dbClient, clientPublicId: string) => {
  return db.query.clients.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      colourCode: true,
      workspaceId: true,
    },
    where: and(eq(clients.publicId, clientPublicId), isNull(clients.deletedAt)),
  });
};

export const create = async (
  db: dbClient,
  clientInput: {
    name: string;
    status: ClientStatus;
    driveUrl: string | null;
    briefUrl: string | null;
    summary: string | null;
    workspaceId: number;
    createdBy: string;
  },
) => {
  const [result] = await db
    .insert(clients)
    .values({
      publicId: generateUID(),
      name: clientInput.name,
      status: clientInput.status,
      colourCode: clientStatusDetails[clientInput.status].colourCode,
      driveUrl: clientInput.driveUrl,
      briefUrl: clientInput.briefUrl,
      summary: clientInput.summary,
      workspaceId: clientInput.workspaceId,
      createdBy: clientInput.createdBy,
    })
    .returning({
      publicId: clients.publicId,
      name: clients.name,
      colourCode: clients.colourCode,
      status: clients.status,
      driveUrl: clients.driveUrl,
      briefUrl: clients.briefUrl,
      summary: clients.summary,
    });

  return result;
};

export const update = async (
  db: dbClient,
  // For driveUrl, briefUrl and summary: undefined keeps the current value,
  // null removes it.
  clientInput: {
    name: string;
    status: ClientStatus;
    driveUrl?: string | null;
    briefUrl?: string | null;
    summary?: string | null;
  },
  args: { clientPublicId: string },
) => {
  const [result] = await db
    .update(clients)
    .set({
      name: clientInput.name,
      status: clientInput.status,
      colourCode: clientStatusDetails[clientInput.status].colourCode,
      ...(clientInput.driveUrl !== undefined && {
        driveUrl: clientInput.driveUrl,
      }),
      ...(clientInput.briefUrl !== undefined && {
        briefUrl: clientInput.briefUrl,
      }),
      ...(clientInput.summary !== undefined && {
        summary: clientInput.summary,
      }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(clients.publicId, args.clientPublicId), isNull(clients.deletedAt)),
    )
    .returning({
      publicId: clients.publicId,
      name: clients.name,
      colourCode: clients.colourCode,
      status: clients.status,
      driveUrl: clients.driveUrl,
      briefUrl: clients.briefUrl,
      summary: clients.summary,
    });

  return result;
};

// Soft-deletes the client and unassigns it from its cards in one go, so no
// card keeps pointing at a client nobody can see anymore.
export const softDelete = (
  db: dbClient,
  args: { clientId: number; deletedBy: string },
) => {
  return db.transaction(async (tx) => {
    await tx
      .update(cards)
      .set({ clientId: null })
      .where(eq(cards.clientId, args.clientId));

    const [result] = await tx
      .update(clients)
      .set({ deletedAt: new Date(), deletedBy: args.deletedBy })
      .where(and(eq(clients.id, args.clientId), isNull(clients.deletedAt)))
      .returning({ publicId: clients.publicId });

    return result;
  });
};

export const setCardClient = async (
  db: dbClient,
  args: { cardId: number; clientId: number | null },
) => {
  const [result] = await db
    .update(cards)
    .set({ clientId: args.clientId, updatedAt: new Date() })
    .where(and(eq(cards.id, args.cardId), isNull(cards.deletedAt)))
    .returning({ publicId: cards.publicId });

  return result;
};
