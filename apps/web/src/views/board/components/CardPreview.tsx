import { useParams } from "next/navigation";

import type { BoardCard } from "../types";
import { api } from "~/utils/api";
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
  const boardValues = api.boardFields.boardValues.useQuery(
    { boardPublicId: boardPublicId ?? "" },
    { enabled: !!boardPublicId && boardPublicId.length >= 12 },
  );

  const fields = boardValues.data?.fields.map((field) => {
    const value = boardValues.data.values.find(
      (v) =>
        v.cardPublicId === card.publicId && v.fieldPublicId === field.publicId,
    );
    const option = field.options.find(
      (o) => o.publicId === value?.optionPublicId,
    );

    return {
      publicId: field.publicId,
      name: field.name,
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
    />
  );
}
