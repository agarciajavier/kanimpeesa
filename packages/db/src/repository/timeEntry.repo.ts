import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cards,
  clients,
  lists,
  timeEntries,
  users,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

// Impeesa: time tracking (see schema/timeEntries.ts).

// Seconds of an entry; a running one counts up to now.
const secondsExpr = sql<number>`GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(${timeEntries.endedAt}, NOW()) - ${timeEntries.startedAt})))`;
const totalSecondsExpr = sql<number>`COALESCE(SUM(${secondsExpr}), 0)`.mapWith(
  (v) => Math.round(Number(v)),
);

const notDeleted = isNull(timeEntries.deletedAt);

// What an entry needs from its card: workspace and client (copied into the
// entry) and the creator (for the edit permission).
export const getCardContext = async (db: dbClient, cardPublicId: string) => {
  const [card] = await db
    .select({
      id: cards.id,
      createdBy: cards.createdBy,
      clientId: cards.clientId,
      workspaceId: boards.workspaceId,
    })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .where(and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)))
    .limit(1);

  return card ?? null;
};

const runningColumns = {
  publicId: timeEntries.publicId,
  startedAt: timeEntries.startedAt,
  cardPublicId: cards.publicId,
  cardTitle: cards.title,
  clientName: clients.name,
  clientColourCode: clients.colourCode,
};

// The timer the person has running, if any, with what the header shows.
export const getRunning = async (db: dbClient, userId: string) => {
  const [entry] = await db
    .select(runningColumns)
    .from(timeEntries)
    .innerJoin(cards, eq(cards.id, timeEntries.cardId))
    .leftJoin(clients, eq(clients.id, timeEntries.clientId))
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNull(timeEntries.endedAt),
        notDeleted,
      ),
    )
    .limit(1);

  return entry ?? null;
};

// Stops whatever the person has running and starts a timer on the card, in
// one go, so there is never more than one running.
export const start = (
  db: dbClient,
  input: {
    userId: string;
    cardId: number;
    clientId: number | null;
    workspaceId: number;
  },
) => {
  return db.transaction(async (tx) => {
    const now = new Date();

    await tx
      .update(timeEntries)
      .set({ endedAt: now, updatedAt: now })
      .where(
        and(
          eq(timeEntries.userId, input.userId),
          isNull(timeEntries.endedAt),
          notDeleted,
        ),
      );

    const [entry] = await tx
      .insert(timeEntries)
      .values({
        publicId: generateUID(),
        workspaceId: input.workspaceId,
        cardId: input.cardId,
        clientId: input.clientId,
        userId: input.userId,
        source: "timer",
        startedAt: now,
      })
      .returning({ publicId: timeEntries.publicId });

    return entry;
  });
};

export const stop = async (db: dbClient, userId: string) => {
  const now = new Date();
  const stopped = await db
    .update(timeEntries)
    .set({ endedAt: now, updatedAt: now })
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNull(timeEntries.endedAt),
        notDeleted,
      ),
    )
    .returning({ publicId: timeEntries.publicId });

  return stopped.length > 0;
};

export const createManual = async (
  db: dbClient,
  input: {
    userId: string;
    cardId: number;
    clientId: number | null;
    workspaceId: number;
    startedAt: Date;
    endedAt: Date;
    note: string | null;
  },
) => {
  const [entry] = await db
    .insert(timeEntries)
    .values({
      publicId: generateUID(),
      ...input,
      source: "manual",
    })
    .returning({ publicId: timeEntries.publicId });

  return entry;
};

// Every entry of a card, newest first, with who logged it.
export const getAllByCardId = (db: dbClient, cardId: number) => {
  return db
    .select({
      publicId: timeEntries.publicId,
      source: timeEntries.source,
      startedAt: timeEntries.startedAt,
      endedAt: timeEntries.endedAt,
      note: timeEntries.note,
      userId: timeEntries.userId,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(and(eq(timeEntries.cardId, cardId), notDeleted))
    .orderBy(desc(timeEntries.startedAt), desc(timeEntries.id));
};

// Total seconds per card of a board, for the clock on each card.
export const getTotalsByBoardId = (db: dbClient, boardId: number) => {
  return db
    .select({ cardPublicId: cards.publicId, seconds: totalSecondsExpr })
    .from(timeEntries)
    .innerJoin(cards, eq(cards.id, timeEntries.cardId))
    .innerJoin(lists, eq(lists.id, cards.listId))
    .where(and(eq(lists.boardId, boardId), notDeleted))
    .groupBy(cards.publicId);
};

export const getByPublicId = async (db: dbClient, entryPublicId: string) => {
  const [entry] = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      workspaceId: timeEntries.workspaceId,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.publicId, entryPublicId), notDeleted))
    .limit(1);

  return entry ?? null;
};

export const softDelete = (db: dbClient, entryId: number) => {
  return db
    .update(timeEntries)
    .set({ deletedAt: new Date() })
    .where(eq(timeEntries.id, entryId));
};

// Base for the stats panel: hours in a period by person and by client, with
// what's needed for profitability (client fee and agreed hours, cost per
// hour of each person). An entry belongs to the period it started in.
export const getSummary = async (
  db: dbClient,
  args: { workspaceId: number; from: Date; to: Date },
) => {
  const inPeriod = and(
    eq(timeEntries.workspaceId, args.workspaceId),
    gte(timeEntries.startedAt, args.from),
    lt(timeEntries.startedAt, args.to),
    notDeleted,
  );

  const [byUser, byClient, byUserAndClient] = await Promise.all([
    db
      .select({
        userId: timeEntries.userId,
        name: users.name,
        email: users.email,
        hourlyCost: workspaceMembers.hourlyCost,
        seconds: totalSecondsExpr,
      })
      .from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.userId))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, timeEntries.userId),
          eq(workspaceMembers.workspaceId, timeEntries.workspaceId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .where(inPeriod)
      .groupBy(
        timeEntries.userId,
        users.name,
        users.email,
        workspaceMembers.hourlyCost,
      ),
    db
      .select({
        clientPublicId: clients.publicId,
        name: clients.name,
        monthlyFee: clients.monthlyFee,
        feeCurrency: clients.feeCurrency,
        contractedHours: clients.contractedHours,
        seconds: totalSecondsExpr,
      })
      .from(timeEntries)
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(inPeriod)
      .groupBy(
        clients.publicId,
        clients.name,
        clients.monthlyFee,
        clients.feeCurrency,
        clients.contractedHours,
      ),
    db
      .select({
        userId: timeEntries.userId,
        clientPublicId: clients.publicId,
        seconds: totalSecondsExpr,
      })
      .from(timeEntries)
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(inPeriod)
      .groupBy(timeEntries.userId, clients.publicId),
  ]);

  return { byUser, byClient, byUserAndClient };
};
