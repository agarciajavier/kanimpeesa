import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { HiXMark } from "react-icons/hi2";

import { colours } from "@kan/shared/constants";

import Button from "~/components/Button";
import Input from "~/components/Input";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

// Impeesa: creates a workspace-wide client (see db/schema/clients.ts).
// When cardPublicId is given, the new client is also assigned to that card.
// Otherwise its publicId is left in modal state NEW_CLIENT_CREATED, so the
// new card form underneath can pick it up.
export function ClientForm({
  workspacePublicId,
  cardPublicId,
}: {
  workspacePublicId: string;
  cardPublicId?: string;
}) {
  const { closeModal, setModalState } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();

  const { register, handleSubmit, watch } = useForm<{ name: string }>({
    values: { name: "" },
  });

  const existingClients = api.clients.all.useQuery(
    { workspacePublicId },
    { enabled: workspacePublicId.length >= 12 },
  );

  const setClient = api.clients.setForCard.useMutation({
    onSettled: async () => {
      if (!cardPublicId) return;
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const createClient = api.clients.create.useMutation({
    onSuccess: async (newClient) => {
      await utils.clients.all.invalidate({ workspacePublicId });
      if (cardPublicId) {
        setClient.mutate({
          cardPublicId,
          clientPublicId: newClient.publicId,
        });
      } else {
        setModalState("NEW_CLIENT_CREATED", newClient.publicId);
      }
      closeModal();
    },
    onError: () => {
      showPopup({
        header: t`Unable to create client`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
  });

  const onSubmit = (values: { name: string }) => {
    const name = values.name.trim();
    if (!name) return;

    // Each new client takes the next colour, so neighbours on the board
    // are easy to tell apart.
    const colour =
      colours[(existingClients.data?.length ?? 0) % colours.length];

    createClient.mutate({
      workspacePublicId,
      name,
      colourCode: colour?.code ?? "#0d9488",
    });
  };

  useEffect(() => {
    document.querySelector<HTMLElement>("#client-name")?.focus();
  }, []);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="px-5 pt-5">
        <div className="flex w-full items-center justify-between pb-4 text-neutral-900 dark:text-dark-1000">
          <h2 className="text-sm font-medium">{t`New client`}</h2>
          <button
            type="button"
            className="rounded p-1 hover:bg-light-300 focus:outline-none dark:hover:bg-dark-300"
            onClick={(e) => {
              e.preventDefault();
              closeModal();
            }}
          >
            <HiXMark size={18} className="text-light-900 dark:text-dark-900" />
          </button>
        </div>

        <Input id="client-name" placeholder={t`Name`} {...register("name")} />
      </div>

      <div className="mt-12 flex items-center justify-end border-t border-light-600 px-5 pb-5 pt-5 dark:border-dark-600">
        <Button
          type="submit"
          isLoading={createClient.isPending}
          disabled={!watch("name")?.trim()}
        >
          {t`Create client`}
        </Button>
      </div>
    </form>
  );
}
