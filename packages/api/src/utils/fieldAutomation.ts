import type { dbClient } from "@kan/db/client";
import * as boardFieldRepo from "@kan/db/repository/boardField.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";

import { sendPush } from "./push";

// Impeesa: choosing an option of a card's field and running the board's
// automations for it (set other fields, move the card, tell the person in
// charge). Shared by the card screen (boardField.setValue) and by onboarding,
// so a field changed by the onboarding behaves exactly like one changed by
// hand.

export type CardContext = NonNullable<
  Awaited<ReturnType<typeof boardFieldRepo.getCardContext>>
>;

export interface FieldChangeResult {
  movedToList: { publicId: string; name: string } | null;
  changedFields: { fieldName: string; optionName: string }[];
  // Fields whose person in charge was sent a notification.
  notifiedFields: string[];
}

export async function applyCardFieldValue(
  db: dbClient,
  {
    card,
    cardPublicId,
    field,
    option,
    userId,
    userName,
    notifyActor = false,
  }: {
    card: CardContext;
    cardPublicId: string;
    field: { id: number; publicId: string; name: string };
    // null empties the field.
    option: { id: number; name: string } | null;
    // Who the change is recorded under.
    userId: string;
    userName?: string | null;
    // The person making a change by hand isn't told about it. Changes made
    // by the onboarding are recorded under whoever registered the client, but
    // that person must still be told.
    notifyActor?: boolean;
  },
): Promise<FieldChangeResult> {
  const result: FieldChangeResult = {
    movedToList: null,
    changedFields: [],
    notifiedFields: [],
  };

  if (!option) {
    await boardFieldRepo.clearCardValue(db, {
      cardId: card.id,
      fieldId: field.id,
    });
    return result;
  }

  const values = await boardFieldRepo.getValuesForCard(db, card.id);
  const previousOptionId = values.find((v) => v.fieldId === field.id)?.optionId;

  await boardFieldRepo.setCardValue(db, {
    cardId: card.id,
    fieldId: field.id,
    optionId: option.id,
    updatedBy: userId,
  });

  if (previousOptionId === option.id) return result;

  const actions = await boardFieldRepo.findMatchingAutomations(db, {
    fieldId: field.id,
    optionId: option.id,
  });

  // Only the original change triggers rules: a field set by a rule doesn't
  // trigger further rules, so rules can never loop.
  let currentListId = card.listId;
  const notifyUserIds = new Set<string>();

  for (const action of actions) {
    if (action.kind === "notify") {
      const assigneeUserId = await boardFieldRepo.getAssigneeUserId(db, {
        cardId: card.id,
        fieldId: action.field.id,
      });
      // Nobody in charge, or it's the person making the change by hand: no
      // one to tell.
      if (assigneeUserId && (notifyActor || assigneeUserId !== userId)) {
        notifyUserIds.add(assigneeUserId);
        result.notifiedFields.push(action.field.name);
      }
    } else if (action.kind === "set") {
      await boardFieldRepo.setCardValue(db, {
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
      await cardRepo.reorder(db, {
        cardId: card.id,
        newListId: action.list.id,
        newIndex: undefined,
      });
      await cardActivityRepo.create(db, {
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
    const by = userName?.trim();
    await sendPush(db, [...notifyUserIds], {
      title: `${field.name} → ${option.name}`,
      body: `${card.title} · ${card.boardName}${by ? ` (${by})` : ""}`,
      url: `/cards/${cardPublicId}`,
      tag: `${cardPublicId}-${field.publicId}`,
    });
  }

  return result;
}
