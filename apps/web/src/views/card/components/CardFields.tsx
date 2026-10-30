import { t } from "@lingui/core/macro";

import Badge from "~/components/Badge";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import LabelIcon from "~/components/LabelIcon";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

// Impeesa: the board's custom fields on a card, one dropdown per field.
// Picking an option may trigger an automation that moves the card.
export default function CardFields({
  cardPublicId,
  disabled = false,
}: {
  cardPublicId: string;
  disabled?: boolean;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();

  const queryInput = { cardPublicId };
  const fields = api.boardFields.forCard.useQuery(queryInput, {
    enabled: cardPublicId.length >= 12,
  });

  const setValue = api.boardFields.setValue.useMutation({
    onMutate: async (update) => {
      await utils.boardFields.forCard.cancel(queryInput);

      const previous = utils.boardFields.forCard.getData(queryInput);

      utils.boardFields.forCard.setData(queryInput, (old) =>
        old?.map((field) =>
          field.publicId === update.fieldPublicId
            ? { ...field, selectedOptionPublicId: update.optionPublicId }
            : field,
        ),
      );

      return { previous };
    },
    onError: (_error, _update, context) => {
      utils.boardFields.forCard.setData(queryInput, context?.previous);
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
      ];

      if (changes.length > 0)
        showPopup({
          header: "Automatización",
          message: `${changes.join(". ")}.`,
          icon: "success",
        });

      if (result.movedToList) {
        await invalidateCard(utils, cardPublicId);
        await utils.board.byId.invalidate();
      }
    },
    onSettled: async () => {
      await utils.boardFields.forCard.invalidate(queryInput);
      await utils.boardFields.boardValues.invalidate();
    },
  });

  if (!fields.data?.length) return null;

  return (
    <>
      {fields.data.map((field) => {
        const selected = field.options.find(
          (o) => o.publicId === field.selectedOptionPublicId,
        );

        return (
          <div key={field.publicId} className="mb-4 flex w-full flex-row">
            <p className="my-2 mb-2 w-[100px] shrink-0 pr-2 text-sm font-medium">
              {field.name}
            </p>
            <CheckboxDropdown
              items={field.options.map((option) => ({
                key: option.publicId,
                value: option.name,
                selected: option.publicId === field.selectedOptionPublicId,
                leftIcon: <LabelIcon colourCode={option.colourCode} />,
              }))}
              handleSelect={(_, option) => {
                // Picking the current option again empties the field.
                setValue.mutate({
                  cardPublicId,
                  fieldPublicId: field.publicId,
                  optionPublicId:
                    option.key === field.selectedOptionPublicId
                      ? null
                      : option.key,
                });
              }}
              disabled={disabled}
              ariaLabel={field.name}
              asChild
            >
              <div
                className={`flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 pl-1 text-left dark:border-dark-50 ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100"}`}
              >
                {selected ? (
                  <Badge
                    value={selected.name}
                    iconLeft={<LabelIcon colourCode={selected.colourCode} />}
                  />
                ) : (
                  <span className="py-1 pl-1 text-sm text-light-700 dark:text-dark-800">
                    –
                  </span>
                )}
              </div>
            </CheckboxDropdown>
          </div>
        );
      })}
    </>
  );
}
