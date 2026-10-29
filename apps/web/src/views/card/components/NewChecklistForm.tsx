import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { HiOutlineTrash, HiXMark } from "react-icons/hi2";

import { generateUID } from "@kan/shared/utils";

import Button from "~/components/Button";
import Input from "~/components/Input";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface NewChecklistFormInput {
  name: string;
  cardPublicId: string;
}

export function NewChecklistForm({
  cardPublicId,
  workspacePublicId,
}: {
  cardPublicId: string;
  workspacePublicId: string;
}) {
  const { closeModal, setModalState } = useModal();
  const { showPopup } = usePopup();

  const utils = api.useUtils();

  const { register, handleSubmit, reset, watch } =
    useForm<NewChecklistFormInput>({
      defaultValues: {
        name: "Checklist",
        cardPublicId,
      },
    });

  const createChecklist = api.checklist.create.useMutation({
    onMutate: async (args) => {
      await utils.card.byId.cancel({ cardPublicId: args.cardPublicId });
      const previous = utils.card.byId.getData({
        cardPublicId: args.cardPublicId,
      });
      const optimisticPublicId = `PLACEHOLDER_${generateUID()}`;
      utils.card.byId.setData({ cardPublicId: args.cardPublicId }, (old) => {
        if (!old) return old as any;
        const placeholderChecklist = {
          publicId: optimisticPublicId,
          name: args.name,
          index: old.checklists.length,
          items: [] as {
            publicId: string;
            title: string;
            completed: boolean;
            index: number;
          }[],
        };
        return {
          ...old,
          checklists: [...old.checklists, placeholderChecklist],
        } as typeof old;
      });
      return { previous, optimisticPublicId };
    },
    onSuccess: (data, vars, context) => {
      setModalState("ADD_CHECKLIST", { createdChecklistId: data.publicId });
      if (!context) return;
      utils.card.byId.setData({ cardPublicId: vars.cardPublicId }, (old) => {
        if (!old) return old as any;
        const updatedChecklists = old.checklists.map((cl) =>
          cl.publicId === context.optimisticPublicId
            ? { ...cl, publicId: data.publicId }
            : cl,
        );
        return { ...old, checklists: updatedChecklists } as typeof old;
      });
    },
    onError: (_error, vars, ctx) => {
      if (ctx?.previous)
        utils.card.byId.setData(
          { cardPublicId: vars.cardPublicId },
          ctx.previous,
        );
      showPopup({
        header: t`Unable to create checklist`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async (_data, _error, vars) => {
      await invalidateCard(utils, vars.cardPublicId);
    },
  });

  // Impeesa: checklist templates (see db/schema/checklistTemplates.ts).
  const templates = api.checklistTemplates.all.useQuery(
    { workspacePublicId },
    { enabled: workspacePublicId.length >= 12 },
  );

  const applyTemplate = api.checklistTemplates.applyToCard.useMutation({
    onError: () => {
      showPopup({
        header: t`Unable to create checklist`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
    },
  });

  const deleteTemplate = api.checklistTemplates.delete.useMutation({
    onSettled: async () => {
      await utils.checklistTemplates.all.invalidate({ workspacePublicId });
    },
  });

  useEffect(() => {
    const nameElement: HTMLElement | null =
      document.querySelector<HTMLElement>("#checklist-name");
    if (nameElement) nameElement.focus();
  }, []);

  const onSubmit = (data: NewChecklistFormInput) => {
    closeModal();
    reset({
      name: "",
    });

    createChecklist.mutate({
      name: data.name,
      cardPublicId: data.cardPublicId,
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="px-5 pt-5">
        <div className="flex w-full items-center justify-between pb-4">
          <h2 className="text-sm font-bold text-neutral-900 dark:text-dark-1000">
            {t`New checklist`}
          </h2>
          <button
            type="button"
            className="rounded p-1 hover:bg-light-200 focus:outline-none dark:hover:bg-dark-300"
            onClick={(e) => {
              e.preventDefault();
              closeModal();
            }}
          >
            <HiXMark size={18} className="text-light-900 dark:text-dark-900" />
          </button>
        </div>

        <Input
          id="checklist-name"
          placeholder={t`Checklist name`}
          {...register("name")}
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              await handleSubmit(onSubmit)();
            }
          }}
        />

        {!!templates.data?.length && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-neutral-900 dark:text-dark-1000">
              O usá una plantilla
            </p>
            <div className="max-h-[220px] space-y-1 overflow-y-auto">
              {templates.data.map((template) => (
                <div
                  key={template.publicId}
                  className="group flex items-center rounded-md ring-1 ring-inset ring-light-600 hover:bg-light-200 dark:ring-dark-700 dark:hover:bg-dark-300"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm text-neutral-900 dark:text-dark-1000"
                    disabled={applyTemplate.isPending}
                    onClick={() => {
                      closeModal();
                      applyTemplate.mutate({
                        cardPublicId,
                        templatePublicId: template.publicId,
                      });
                    }}
                  >
                    <span className="truncate">{template.name}</span>
                    <span className="ml-2 flex-shrink-0 text-xs text-light-900 dark:text-dark-800">
                      {template.items.length}{" "}
                      {template.items.length === 1 ? "ítem" : "ítems"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Borrar plantilla"
                    title="Borrar plantilla"
                    className="mr-1 rounded p-1 text-light-900 opacity-0 group-hover:opacity-100 hover:bg-light-300 dark:text-dark-800 dark:hover:bg-dark-400"
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Borrar la plantilla "${template.name}"? Los checklists ya creados no cambian.`,
                        )
                      ) {
                        deleteTemplate.mutate({
                          templatePublicId: template.publicId,
                        });
                      }
                    }}
                  >
                    <HiOutlineTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-12 flex items-center justify-end border-t border-light-600 px-5 pb-5 pt-5 dark:border-dark-600">
        <div>
          <Button
            type="submit"
            disabled={createChecklist.isPending || !watch("name")}
          >
            {t`Create checklist`}
          </Button>
        </div>
      </div>
    </form>
  );
}
