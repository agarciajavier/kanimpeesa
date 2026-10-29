import { and, asc, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { checklistItems, checklistTemplates } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

// Impeesa: see schema/checklistTemplates.ts.

export const getAllByWorkspaceId = (db: dbClient, workspaceId: number) => {
  return db.query.checklistTemplates.findMany({
    columns: {
      publicId: true,
      name: true,
      items: true,
    },
    where: and(
      eq(checklistTemplates.workspaceId, workspaceId),
      isNull(checklistTemplates.deletedAt),
    ),
    orderBy: [asc(checklistTemplates.name)],
  });
};

export const getByPublicId = (db: dbClient, templatePublicId: string) => {
  return db.query.checklistTemplates.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      items: true,
      workspaceId: true,
    },
    where: and(
      eq(checklistTemplates.publicId, templatePublicId),
      isNull(checklistTemplates.deletedAt),
    ),
  });
};

// Item titles of a checklist, in order, for saving it as a template.
export const getChecklistItemTitles = async (
  db: dbClient,
  checklistId: number,
) => {
  const items = await db.query.checklistItems.findMany({
    columns: { title: true },
    where: and(
      eq(checklistItems.checklistId, checklistId),
      isNull(checklistItems.deletedAt),
    ),
    orderBy: [asc(checklistItems.index)],
  });

  return items.map((item) => item.title);
};

// Saving a template with the name of an existing one replaces its items, so
// "save as template" again is how a template gets updated.
export const saveByName = (
  db: dbClient,
  templateInput: {
    name: string;
    items: string[];
    workspaceId: number;
    createdBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const existing = await tx.query.checklistTemplates.findFirst({
      columns: { id: true },
      where: and(
        eq(checklistTemplates.workspaceId, templateInput.workspaceId),
        eq(checklistTemplates.name, templateInput.name),
        isNull(checklistTemplates.deletedAt),
      ),
    });

    const returning = {
      publicId: checklistTemplates.publicId,
      name: checklistTemplates.name,
      items: checklistTemplates.items,
    };

    if (existing) {
      const [result] = await tx
        .update(checklistTemplates)
        .set({ items: templateInput.items, updatedAt: new Date() })
        .where(eq(checklistTemplates.id, existing.id))
        .returning(returning);

      return result ? { ...result, replaced: true } : undefined;
    }

    const [result] = await tx
      .insert(checklistTemplates)
      .values({
        publicId: generateUID(),
        name: templateInput.name,
        items: templateInput.items,
        workspaceId: templateInput.workspaceId,
        createdBy: templateInput.createdBy,
      })
      .returning(returning);

    return result ? { ...result, replaced: false } : undefined;
  });
};

export const softDelete = async (db: dbClient, templateId: number) => {
  const [result] = await db
    .update(checklistTemplates)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(checklistTemplates.id, templateId),
        isNull(checklistTemplates.deletedAt),
      ),
    )
    .returning({ publicId: checklistTemplates.publicId });

  return result;
};
