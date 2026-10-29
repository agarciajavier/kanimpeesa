import { and, asc, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cards, clients } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

// Impeesa: clients are workspace-wide (see schema/clients.ts).

export const getAllByWorkspaceId = (db: dbClient, workspaceId: number) => {
  return db.query.clients.findMany({
    columns: {
      publicId: true,
      name: true,
      colourCode: true,
    },
    where: and(eq(clients.workspaceId, workspaceId), isNull(clients.deletedAt)),
    orderBy: [asc(clients.name)],
  });
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
    colourCode: string;
    workspaceId: number;
    createdBy: string;
  },
) => {
  const [result] = await db
    .insert(clients)
    .values({
      publicId: generateUID(),
      name: clientInput.name,
      colourCode: clientInput.colourCode,
      workspaceId: clientInput.workspaceId,
      createdBy: clientInput.createdBy,
    })
    .returning({
      publicId: clients.publicId,
      name: clients.name,
      colourCode: clients.colourCode,
    });

  return result;
};

export const update = async (
  db: dbClient,
  clientInput: { name: string; colourCode: string },
  args: { clientPublicId: string },
) => {
  const [result] = await db
    .update(clients)
    .set({
      name: clientInput.name,
      colourCode: clientInput.colourCode,
      updatedAt: new Date(),
    })
    .where(
      and(eq(clients.publicId, args.clientPublicId), isNull(clients.deletedAt)),
    )
    .returning({
      publicId: clients.publicId,
      name: clients.name,
      colourCode: clients.colourCode,
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
