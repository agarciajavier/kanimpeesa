import { t } from "@lingui/core/macro";
import { HiMiniPlus } from "react-icons/hi2";

import Badge from "~/components/Badge";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import LabelIcon from "~/components/LabelIcon";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

// Impeesa: one client per card, picked from the workspace's clients.
interface ClientSelectorProps {
  cardPublicId: string;
  workspacePublicId: string;
  selectedClient: {
    publicId: string;
    name: string;
    colourCode: string | null;
  } | null;
  isLoading: boolean;
  disabled?: boolean;
}

export default function ClientSelector({
  cardPublicId,
  workspacePublicId,
  selectedClient,
  isLoading,
  disabled = false,
}: ClientSelectorProps) {
  const utils = api.useUtils();
  const { openModal } = useModal();
  const { showPopup } = usePopup();

  const clients = api.clients.all.useQuery(
    { workspacePublicId },
    { enabled: workspacePublicId.length >= 12 },
  );

  const setClient = api.clients.setForCard.useMutation({
    onMutate: async (update) => {
      await utils.card.byId.cancel();

      const previousCard = utils.card.byId.getData({ cardPublicId });

      utils.card.byId.setData({ cardPublicId }, (oldCard) => {
        if (!oldCard) return oldCard;

        const client =
          clients.data?.find((c) => c.publicId === update.clientPublicId) ??
          null;

        return { ...oldCard, client };
      });

      return { previousCard };
    },
    onError: (_error, _update, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      showPopup({
        header: t`Unable to update client`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const items =
    clients.data?.map((client) => ({
      key: client.publicId,
      value: client.name,
      selected: client.publicId === selectedClient?.publicId,
      leftIcon: <LabelIcon colourCode={client.colourCode} />,
    })) ?? [];

  return (
    <>
      {isLoading ? (
        <div className="flex w-full">
          <div className="h-full w-[175px] animate-pulse rounded-[5px] bg-light-300 dark:bg-dark-300" />
        </div>
      ) : (
        <CheckboxDropdown
          items={items}
          handleSelect={(_, client) => {
            // Picking the current client again clears it.
            setClient.mutate({
              cardPublicId,
              clientPublicId:
                client.key === selectedClient?.publicId ? null : client.key,
            });
          }}
          handleCreate={disabled ? undefined : () => openModal("NEW_CLIENT")}
          createNewItemLabel={t`Create new client`}
          ariaLabel={t`Client`}
          disabled={disabled}
          asChild
        >
          {selectedClient ? (
            <div className="flex flex-wrap gap-x-0.5">
              <Badge
                value={selectedClient.name}
                iconLeft={<LabelIcon colourCode={selectedClient.colourCode} />}
              />
            </div>
          ) : (
            <div
              className={`flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 pl-2 text-left text-sm text-neutral-900 dark:border-dark-50 dark:text-dark-1000 ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100"}`}
            >
              <HiMiniPlus size={22} className="pr-2" />
              {t`Add client`}
            </div>
          )}
        </CheckboxDropdown>
      )}
    </>
  );
}
