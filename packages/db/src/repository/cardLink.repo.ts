import { and, asc, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cardLinks, cards } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

// Impeesa: Drive (or any web) links on a card (see schema/cardLinks.ts).

// The card plus what the links section shows next to its own links: the
// Drive folder and the brief of the card's client (null when it has neither).
export const getCardWithClientFolder = async (
  db: dbClient,
  cardPublicId: string,
) => {
  const card = await db.query.cards.findFirst({
    columns: { id: true, createdBy: true },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
    with: {
      client: {
        columns: {
          name: true,
          driveUrl: true,
          briefUrl: true,
          deletedAt: true,
        },
      },
      list: {
        columns: {},
        with: { board: { columns: { workspaceId: true } } },
      },
    },
  });

  if (!card) return null;

  const client =
    card.client &&
    !card.client.deletedAt &&
    (card.client.driveUrl ?? card.client.briefUrl)
      ? {
          name: card.client.name,
          driveUrl: card.client.driveUrl,
          briefUrl: card.client.briefUrl,
        }
      : null;

  return {
    id: card.id,
    createdBy: card.createdBy,
    workspaceId: card.list.board.workspaceId,
    clientFolder: client,
  };
};

export const getAllByCardId = (db: dbClient, cardId: number) => {
  return db.query.cardLinks.findMany({
    columns: { publicId: true, title: true, url: true },
    where: and(eq(cardLinks.cardId, cardId), isNull(cardLinks.deletedAt)),
    orderBy: [asc(cardLinks.createdAt), asc(cardLinks.id)],
  });
};

export const getByPublicId = async (db: dbClient, linkPublicId: string) => {
  const link = await db.query.cardLinks.findFirst({
    columns: { id: true },
    where: and(
      eq(cardLinks.publicId, linkPublicId),
      isNull(cardLinks.deletedAt),
    ),
    with: {
      card: {
        columns: { createdBy: true },
        with: {
          list: {
            columns: {},
            with: { board: { columns: { workspaceId: true } } },
          },
        },
      },
    },
  });

  return link
    ? {
        id: link.id,
        cardCreatedBy: link.card.createdBy,
        workspaceId: link.card.list.board.workspaceId,
      }
    : null;
};

export const create = async (
  db: dbClient,
  input: { cardId: number; title: string; url: string; createdBy: string },
) => {
  const [link] = await db
    .insert(cardLinks)
    .values({ publicId: generateUID(), ...input })
    .returning({
      publicId: cardLinks.publicId,
      title: cardLinks.title,
      url: cardLinks.url,
    });

  return link;
};

export const softDelete = (db: dbClient, linkId: number) => {
  return db
    .update(cardLinks)
    .set({ deletedAt: new Date() })
    .where(eq(cardLinks.id, linkId));
};
