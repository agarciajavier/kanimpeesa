import { useParams } from "next/navigation";
import { t } from "@lingui/core/macro";

import type { BoardCard } from "../types";
import { formatDuration, TimerButton } from "~/components/TimeTracker";
import { usePermissions } from "~/hooks/usePermissions";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import Card from "./Card";

interface CardPreviewProps {
  card: BoardCard;
  cardPrefix: string;
}

export default function CardPreview({ card, cardPrefix }: CardPreviewProps) {
  // Impeesa: the board's custom fields. Every card asks for the same query,
  // so it is fetched once per board.
  const params = useParams() as { boardId?: string | string[] } | null;
  const boardPublicId = Array.isArray(params?.boardId)
    ? params.boardId[0]
    : params?.boardId;
  const boardValuesInput = { boardPublicId: boardPublicId ?? "" };
  const boardValues = api.boardFields.boardValues.useQuery(boardValuesInput, {
    enabled: !!boardPublicId && boardPublicId.length >= 12,
  });

  // Impeesa: fields can be changed from the board (same rules as inside the
  // card: automations run and whoever is in charge is notified).
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { canEditCard } = usePermissions();
  const isPlaceholder = card.publicId.startsWith("PLACEHOLDER");

  const setValue = api.boardFields.setValue.useMutation({
    onMutate: async (update) => {
      await utils.boardFields.boardValues.cancel(boardValuesInput);
      const previous = utils.boardFields.boardValues.getData(boardValuesInput);

      utils.boardFields.boardValues.setData(boardValuesInput, (old) => {
        if (!old) return old;
        const values = old.values.filter(
          (v) =>
            !(
              v.cardPublicId === update.cardPublicId &&
              v.fieldPublicId === update.fieldPublicId
            ),
        );
        if (update.optionPublicId)
          values.push({
            cardPublicId: update.cardPublicId,
            fieldPublicId: update.fieldPublicId,
            optionPublicId: update.optionPublicId,
          });
        return { ...old, values };
      });

      return { previous };
    },
    onError: (_error, _update, context) => {
      utils.boardFields.boardValues.setData(
        boardValuesInput,
        context?.previous,
      );
      showPopup({
        header: "No se pudo guardar el campo",
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSuccess: async (result) => {
      const changes = [
        ...result.changedFields.map(
          (c) => `${c.fieldName} pasó a "${c.optionName}"`,
        ),
        ...(result.movedToList
          ? [`La tarjeta pasó a "${result.movedToList.name}"`]
          : []),
        ...result.notifiedFields.map((f) => `Se avisó al responsable de ${f}`),
      ];

      if (changes.length > 0)
        showPopup({
          header: "Automatización",
          message: `${changes.join(". ")}.`,
          icon: "success",
        });

      if (result.movedToList) {
        await invalidateCard(utils, card.publicId);
        await utils.board.byId.invalidate();
      }
    },
    onSettled: async () => {
      await utils.boardFields.boardValues.invalidate(boardValuesInput);
      await utils.boardFields.forCard.invalidate({
        cardPublicId: card.publicId,
      });
    },
  });

  // Impeesa: time logged per card, also once per board.
  const timeTotals = api.timeEntries.boardTotals.useQuery(
    { boardPublicId: boardPublicId ?? "" },
    { enabled: !!boardPublicId && boardPublicId.length >= 12 },
  );
  const loggedSeconds =
    timeTotals.data?.find((t) => t.cardPublicId === card.publicId)?.seconds ??
    0;

  const fields = boardValues.data?.fields.map((field) => {
    const value = boardValues.data.values.find(
      (v) =>
        v.cardPublicId === card.publicId && v.fieldPublicId === field.publicId,
    );
    const option = field.options.find(
      (o) => o.publicId === value?.optionPublicId,
    );
    const assignee = boardValues.data.assignees.find(
      (a) =>
        a.cardPublicId === card.publicId && a.fieldPublicId === field.publicId,
    );

    return {
      publicId: field.publicId,
      name: field.name,
      options: field.options,
      selectedOptionPublicId: option?.publicId ?? null,
      assignee: assignee
        ? { name: assignee.name, email: assignee.email, image: assignee.image }
        : null,
      option: option
        ? {
            name: option.name,
            colourCode: option.colourCode,
            isDone: option.isDone,
          }
        : null,
      // Only fields with a "finished" option count towards the progress,
      // and optional ones only once they're used.
      countsForProgress:
        field.options.some((o) => o.isDone) && (!field.isOptional || !!option),
    };
  });

  return (
    <Card
      title={card.title}
      ticketNumber={
        card.cardNumber != null ? `${cardPrefix}-${card.cardNumber}` : null
      }
      labels={card.labels}
      members={card.members}
      checklists={card.checklists ?? []}
      description={card.description ?? null}
      comments={card.comments ?? []}
      attachments={card.attachments}
      dueDate={card.dueDate ?? null}
      client={card.client}
      fields={fields}
      onFieldChange={
        canEditCard && !isPlaceholder
          ? (fieldPublicId, optionPublicId) =>
              setValue.mutate({
                cardPublicId: card.publicId,
                fieldPublicId,
                optionPublicId,
              })
          : undefined
      }
      timer={
        isPlaceholder ? undefined : (
          <span className="-ml-1.5 flex items-center text-light-800 dark:text-dark-800">
            <TimerButton cardPublicId={card.publicId} size="sm" />
            {loggedSeconds >= 60 && (
              <span className="text-[11px]">
                {formatDuration(loggedSeconds)}
              </span>
            )}
          </span>
        )
      }
    />
  );
}
