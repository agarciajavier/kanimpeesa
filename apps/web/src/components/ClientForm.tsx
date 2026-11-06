import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { HiXMark } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { ClientStatus, ClientType } from "@kan/shared/constants";
import {
  clientStatusDetails,
  clientStatuses,
  clientTypeDetails,
  clientTypes,
} from "@kan/shared/constants";

import Button from "~/components/Button";
import Input from "~/components/Input";
import LabelIcon from "~/components/LabelIcon";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface ClientFormInput {
  name: string;
  status: ClientStatus;
  type: ClientType | null;
  driveUrl: string;
  briefUrl: string;
  summary: string;
}

// Impeesa: creates or edits a workspace-wide client (see db/schema/clients.ts).
// The client's colour comes from its status.
// When creating with cardPublicId, the new client is also assigned to that
// card. Otherwise its publicId is left in modal state NEW_CLIENT_CREATED, so
// the new card form underneath can pick it up.
// When editing, the client is the modal's entityId.
export function ClientForm({
  workspacePublicId,
  cardPublicId,
  isEdit,
}: {
  workspacePublicId: string;
  cardPublicId?: string;
  isEdit?: boolean;
}) {
  const { closeModal, setModalState, entityId } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();

  const clients = api.clients.all.useQuery(
    { workspacePublicId },
    { enabled: workspacePublicId.length >= 12 },
  );

  const editedClient = isEdit
    ? clients.data?.find((client) => client.publicId === entityId)
    : undefined;

  const { register, handleSubmit, watch, setValue } = useForm<ClientFormInput>({
    values: {
      name: editedClient?.name ?? "",
      status: editedClient?.status ?? "starting",
      type: editedClient?.type ?? null,
      driveUrl: editedClient?.driveUrl ?? "",
      briefUrl: editedClient?.briefUrl ?? "",
      summary: editedClient?.summary ?? "",
    },
  });

  const selectedStatus = watch("status");
  const selectedType = watch("type");

  // The client shows up on cards and boards, so all of them are refreshed.
  const refreshAfterChange = async () => {
    await utils.clients.all.invalidate({ workspacePublicId });
    await utils.clients.overview.invalidate({ workspacePublicId });
    await utils.cardLinks.forCard.invalidate();
    await utils.board.byId.invalidate();
    await utils.card.byId.invalidate();
  };

  const showError = () =>
    showPopup({
      header: t`Unable to save client`,
      message: t`Please try again later, or contact customer support.`,
      icon: "error",
    });

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
      await utils.clients.overview.invalidate({ workspacePublicId });
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
    onError: showError,
  });

  const updateClient = api.clients.update.useMutation({
    onSuccess: async () => {
      await refreshAfterChange();
      closeModal();
    },
    onError: showError,
  });

  const onSubmit = (values: ClientFormInput) => {
    const name = values.name.trim();
    if (!name) return;
    const driveUrl = values.driveUrl.trim() || null;
    const briefUrl = values.briefUrl.trim() || null;
    const summary = values.summary.trim() || null;

    if (isEdit) {
      updateClient.mutate({
        clientPublicId: entityId,
        name,
        status: values.status,
        type: values.type,
        driveUrl,
        briefUrl,
        summary,
      });
    } else {
      createClient.mutate({
        workspacePublicId,
        name,
        status: values.status,
        type: values.type,
        driveUrl,
        briefUrl,
        summary,
      });
    }
  };

  useEffect(() => {
    document.querySelector<HTMLElement>("#client-name")?.focus();
  }, []);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="px-5 pt-5">
        <div className="flex w-full items-center justify-between pb-4 text-neutral-900 dark:text-dark-1000">
          <h2 className="text-sm font-medium">
            {isEdit ? t`Edit client` : t`New client`}
          </h2>
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

        <p className="mb-2 mt-4 text-xs font-medium text-neutral-900 dark:text-dark-1000">
          Estado
        </p>
        <div className="grid grid-cols-2 gap-2">
          {clientStatuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setValue("status", status)}
              className={twMerge(
                "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-neutral-900 ring-1 ring-inset ring-light-600 hover:bg-light-200 dark:text-dark-1000 dark:ring-dark-700 dark:hover:bg-dark-300",
                selectedStatus === status &&
                  "bg-light-200 ring-2 ring-light-900 dark:bg-dark-300 dark:ring-dark-900",
              )}
            >
              <LabelIcon colourCode={clientStatusDetails[status].colourCode} />
              {clientStatusDetails[status].name}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-4 text-xs font-medium text-neutral-900 dark:text-dark-1000">
          Tipo de cliente
        </p>
        <div className="grid grid-cols-2 gap-2">
          {clientTypes.map((type) => (
            <button
              key={type}
              type="button"
              // Picking the selected type again clears it.
              onClick={() =>
                setValue("type", selectedType === type ? null : type)
              }
              className={twMerge(
                "rounded-md px-3 py-2 text-left text-sm text-neutral-900 ring-1 ring-inset ring-light-600 hover:bg-light-200 dark:text-dark-1000 dark:ring-dark-700 dark:hover:bg-dark-300",
                selectedType === type &&
                  "bg-light-200 ring-2 ring-light-900 dark:bg-dark-300 dark:ring-dark-900",
              )}
            >
              {clientTypeDetails[type].name}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-4 text-xs font-medium text-neutral-900 dark:text-dark-1000">
          Carpeta de Drive (opcional)
        </p>
        <Input
          id="client-drive-url"
          placeholder="https://drive.google.com/drive/folders/..."
          {...register("driveUrl")}
        />
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">
          Aparece en todas las tarjetas de este cliente.
        </p>

        <p className="mb-2 mt-4 text-xs font-medium text-neutral-900 dark:text-dark-1000">
          Brief (opcional)
        </p>
        <Input
          id="client-brief-url"
          placeholder="https://docs.google.com/document/d/..."
          {...register("briefUrl")}
        />

        <p className="mb-2 mt-4 text-xs font-medium text-neutral-900 dark:text-dark-1000">
          Resumen (opcional)
        </p>
        <textarea
          id="client-summary"
          rows={3}
          maxLength={2000}
          placeholder="Qué vende, objetivo, tono, lo importante del cliente..."
          className="block w-full rounded-md border-0 bg-white/5 px-3 py-1.5 text-sm text-neutral-900 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700"
          {...register("summary")}
        />
      </div>

      <div className="mt-12 flex items-center justify-end border-t border-light-600 px-5 pb-5 pt-5 dark:border-dark-600">
        <Button
          type="submit"
          isLoading={createClient.isPending || updateClient.isPending}
          disabled={!watch("name")?.trim()}
        >
          {isEdit ? t`Update client` : t`Create client`}
        </Button>
      </div>
    </form>
  );
}
