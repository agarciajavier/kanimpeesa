import { useState } from "react";
import { HiOutlinePencil, HiOutlineTrash, HiPlus } from "react-icons/hi2";

import { clientStatusDetails } from "@kan/shared/constants";

import Button from "~/components/Button";
import { ClientForm } from "~/components/ClientForm";
import LabelIcon from "~/components/LabelIcon";
import Modal from "~/components/modal";
import { PageHead } from "~/components/PageHead";
import { usePermissions } from "~/hooks/usePermissions";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { LinkRow } from "~/views/card/components/CardLinks";

// Impeesa: every client of the workspace with its status, Drive folder,
// brief, summary and how many tasks it has.
export default function ClientsView() {
  const { workspace } = useWorkspace();
  const { modalContentType, openModal, isOpen } = useModal();
  const { showPopup } = usePopup();
  const { canEditBoard } = usePermissions();
  const utils = api.useUtils();

  const workspacePublicId = workspace.publicId;
  const queryInput = { workspacePublicId };
  const clients = api.clients.overview.useQuery(queryInput, {
    enabled: !!workspacePublicId && workspacePublicId.length >= 12,
  });

  // Only one preview open at a time across the whole page.
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const togglePreview = (key: string) =>
    setOpenPreview((current) => (current === key ? null : key));

  const deleteClient = api.clients.delete.useMutation({
    onSuccess: async () => {
      await utils.clients.overview.invalidate(queryInput);
      await utils.clients.all.invalidate(queryInput);
      await utils.board.byId.invalidate();
    },
    onError: () =>
      showPopup({
        header: "No se pudo borrar el cliente",
        message: "Probá de nuevo en un rato.",
        icon: "error",
      }),
  });

  return (
    <>
      <PageHead title={`Clientes | ${workspace.name ?? "Workspace"}`} />
      <div className="h-full overflow-y-auto">
        <div className="m-auto max-w-[1100px] p-8 px-5 md:px-28 md:py-12">
          <div className="mb-8 flex w-full items-center justify-between">
            <h1 className="font-bold tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
              Clientes
            </h1>
            {canEditBoard && (
              <Button
                iconLeft={<HiPlus className="h-4 w-4" />}
                onClick={() => openModal("NEW_CLIENT")}
              >
                Nuevo cliente
              </Button>
            )}
          </div>

          {clients.isLoading && (
            <div className="h-24 w-full animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
          )}

          {clients.data?.length === 0 && (
            <p className="text-sm text-neutral-500 dark:text-dark-900">
              Todavía no hay clientes.
            </p>
          )}

          <div className="space-y-3">
            {clients.data?.map((client) => (
              <div
                key={client.publicId}
                className="rounded-md border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <LabelIcon colourCode={client.colourCode} />
                  <p className="font-medium text-neutral-900 dark:text-dark-1000">
                    {client.name}
                  </p>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      color: clientStatusDetails[client.status].colourCode,
                      backgroundColor: `${clientStatusDetails[client.status].colourCode}22`,
                    }}
                  >
                    {clientStatusDetails[client.status].name}
                  </span>
                  <span className="text-xs text-light-800 dark:text-dark-800">
                    {client.taskCount === 1
                      ? "1 tarea"
                      : `${client.taskCount} tareas`}
                  </span>
                  {canEditBoard && (
                    <div className="ml-auto flex items-center gap-1 text-light-900 dark:text-dark-900">
                      <button
                        type="button"
                        aria-label="Editar cliente"
                        onClick={() =>
                          openModal("EDIT_CLIENT", client.publicId)
                        }
                        className="rounded p-1 hover:bg-light-200 dark:hover:bg-dark-200"
                      >
                        <HiOutlinePencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Borrar cliente"
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Borrar el cliente "${client.name}"? Sus tarjetas quedan, pero sin cliente.`,
                            )
                          )
                            deleteClient.mutate({
                              clientPublicId: client.publicId,
                            });
                        }}
                        className="rounded p-1 hover:bg-light-200 dark:hover:bg-dark-200"
                      >
                        <HiOutlineTrash className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {client.summary && (
                  <p className="mt-2 whitespace-pre-line text-sm text-light-900 dark:text-dark-900">
                    {client.summary}
                  </p>
                )}

                {(client.driveUrl ?? client.briefUrl) && (
                  <div className="mt-2">
                    {client.driveUrl && (
                      <LinkRow
                        rowKey={`${client.publicId}-folder`}
                        title="Carpeta de Drive"
                        url={client.driveUrl}
                        openPreview={openPreview}
                        onTogglePreview={togglePreview}
                      />
                    )}
                    {client.briefUrl && (
                      <LinkRow
                        rowKey={`${client.publicId}-brief`}
                        title="Brief"
                        url={client.briefUrl}
                        openPreview={openPreview}
                        onTogglePreview={togglePreview}
                      />
                    )}
                  </div>
                )}

                {!client.summary && !client.driveUrl && !client.briefUrl && (
                  <p className="mt-2 text-xs text-light-800 dark:text-dark-800">
                    Sin resumen, carpeta ni brief todavía.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        modalSize="sm"
        isVisible={isOpen && modalContentType === "NEW_CLIENT"}
      >
        <ClientForm workspacePublicId={workspacePublicId} />
      </Modal>
      <Modal
        modalSize="sm"
        isVisible={isOpen && modalContentType === "EDIT_CLIENT"}
      >
        <ClientForm workspacePublicId={workspacePublicId} isEdit />
      </Modal>
    </>
  );
}
