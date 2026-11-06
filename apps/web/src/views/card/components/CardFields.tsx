import { t } from "@lingui/core/macro";
import { HiOutlineUserPlus } from "react-icons/hi2";

import Avatar from "~/components/Avatar";
import Badge from "~/components/Badge";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import LabelIcon from "~/components/LabelIcon";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { formatMemberDisplayName, getAvatarUrl } from "~/utils/helpers";

export interface CardFieldMember {
  publicId: string;
  email: string;
  name: string | null;
  image: string | null;
}

const NO_ASSIGNEE = "__none__";

// Impeesa: the board's custom fields on a card, one dropdown per field, and
// next to each one the person in charge of that step (picked from the
// card's members). Picking an option may trigger automations that move the
// card, change other fields or notify whoever is in charge.
export default function CardFields({
  cardPublicId,
  members = [],
  disabled = false,
}: {
  cardPublicId: string;
  members?: CardFieldMember[];
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
        ...result.notifiedFields.map((f) => `Se avisó al responsable de ${f}`),
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

  const setAssignee = api.boardFields.setAssignee.useMutation({
    onMutate: async (update) => {
      await utils.boardFields.forCard.cancel(queryInput);

      const previous = utils.boardFields.forCard.getData(queryInput);
      const member = members.find((m) => m.publicId === update.memberPublicId);

      utils.boardFields.forCard.setData(queryInput, (old) =>
        old?.map((field) =>
          field.publicId === update.fieldPublicId
            ? {
                ...field,
                assignee: member
                  ? {
                      memberPublicId: member.publicId,
                      email: member.email,
                      name: member.name,
                      image: member.image,
                    }
                  : null,
              }
            : field,
        ),
      );

      return { previous };
    },
    onError: (_error, _update, context) => {
      utils.boardFields.forCard.setData(queryInput, context?.previous);
      showPopup({
        header: "No se pudo guardar el responsable",
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await utils.boardFields.forCard.invalidate(queryInput);
      await utils.boardFields.boardValues.invalidate();
    },
  });

  if (!fields.data?.length) return null;

  const memberAvatar = (m: {
    name: string | null;
    email: string;
    image: string | null;
  }) => (
    <Avatar
      size="xs"
      name={m.name ?? ""}
      email={m.email}
      imageUrl={m.image ? getAvatarUrl(m.image) : undefined}
    />
  );

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
            <div className="w-9 shrink-0">
              <CheckboxDropdown
                items={[
                  ...members.map((member) => ({
                    key: member.publicId,
                    value: formatMemberDisplayName(member.name, member.email),
                    selected:
                      member.publicId === field.assignee?.memberPublicId,
                    leftIcon: memberAvatar(member),
                  })),
                  ...(field.assignee
                    ? [
                        {
                          key: NO_ASSIGNEE,
                          value: "Sin responsable",
                          selected: false,
                        },
                      ]
                    : []),
                ]}
                footer={
                  members.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-light-800 dark:text-dark-800">
                      Primero asigná miembros a la tarea.
                    </p>
                  ) : undefined
                }
                position="right"
                handleSelect={(_, item) => {
                  // Picking the current person again leaves the step empty.
                  const memberPublicId =
                    item.key === NO_ASSIGNEE ||
                    item.key === field.assignee?.memberPublicId
                      ? null
                      : item.key;
                  setAssignee.mutate({
                    cardPublicId,
                    fieldPublicId: field.publicId,
                    memberPublicId,
                  });
                }}
                disabled={disabled}
                ariaLabel={`Responsable de ${field.name}`}
                asChild
              >
                <div
                  title={
                    field.assignee
                      ? `Responsable: ${formatMemberDisplayName(field.assignee.name, field.assignee.email)}`
                      : `Elegir responsable de ${field.name}`
                  }
                  className={`ml-1 flex h-full shrink-0 items-center rounded-[5px] px-1 ${disabled ? "cursor-not-allowed opacity-60" : "hover:bg-light-200 dark:hover:bg-dark-100"}`}
                >
                  {field.assignee ? (
                    memberAvatar(field.assignee)
                  ) : (
                    <HiOutlineUserPlus className="h-5 w-5 text-light-700 dark:text-dark-800" />
                  )}
                </div>
              </CheckboxDropdown>
            </div>
          </div>
        );
      })}
    </>
  );
}
