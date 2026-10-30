import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import {
  HiArrowLeft,
  HiChevronDown,
  HiChevronUp,
  HiOutlinePencil,
  HiOutlineTrash,
  HiPlus,
  HiXMark,
} from "react-icons/hi2";

import Badge from "~/components/Badge";
import Button from "~/components/Button";
import LabelIcon from "~/components/LabelIcon";
import { PageHead } from "~/components/PageHead";
import { usePermissions } from "~/hooks/usePermissions";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

// Impeesa: page to set up a board's custom fields and its automations
// ("when <field> changes to <option>, move the card to <list>").

const COLOURS = [
  { code: "#eab308", name: "Amarillo" },
  { code: "#0ea5e9", name: "Celeste" },
  { code: "#16a34a", name: "Verde" },
  { code: "#f97316", name: "Naranja" },
  { code: "#dc2626", name: "Rojo" },
  { code: "#8b5cf6", name: "Violeta" },
  { code: "#ec4899", name: "Rosa" },
  { code: "#9ca3af", name: "Gris" },
];

const DEFAULT_OPTIONS = [
  { name: "Pendiente", colourCode: "#eab308" },
  { name: "Haciendo", colourCode: "#0ea5e9" },
  { name: "Listo", colourCode: "#16a34a" },
];

interface OptionDraft {
  publicId?: string;
  name: string;
  colourCode: string | null;
}

interface FieldDraft {
  publicId?: string;
  name: string;
  options: OptionDraft[];
}

const inputClass =
  "block w-full rounded-md border-0 bg-white/5 px-3 py-1.5 text-sm text-neutral-900 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700";

const sectionTitleClass =
  "mb-2 mt-8 text-[14px] font-bold text-neutral-900 dark:text-dark-1000";

const helpClass = "mb-4 text-sm text-neutral-500 dark:text-dark-900";

function FieldEditor({
  draft,
  isSaving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: FieldDraft;
  isSaving: boolean;
  onChange: (draft: FieldDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const setOption = (index: number, option: Partial<OptionDraft>) =>
    onChange({
      ...draft,
      options: draft.options.map((o, i) =>
        i === index ? { ...o, ...option } : o,
      ),
    });

  const canSave =
    draft.name.trim().length > 0 &&
    draft.options.length > 0 &&
    draft.options.every((o) => o.name.trim().length > 0);

  return (
    <div className="rounded-md border border-light-300 p-4 dark:border-dark-300">
      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-dark-900">
        Nombre del campo
      </label>
      <input
        className={inputClass}
        value={draft.name}
        placeholder="Por ejemplo: Diseño"
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        autoFocus
      />

      <p className="mb-1 mt-4 text-xs font-medium text-neutral-600 dark:text-dark-900">
        Opciones (la primera es la que tiene una tarjeta nueva)
      </p>
      <div className="space-y-2">
        {draft.options.map((option, index) => (
          <div
            key={option.publicId ?? `new-${index}`}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              className={`${inputClass} max-w-[200px]`}
              value={option.name}
              placeholder="Nombre de la opción"
              onChange={(e) => setOption(index, { name: e.target.value })}
            />
            <div className="flex gap-1">
              {COLOURS.map((colour) => (
                <button
                  key={colour.code}
                  type="button"
                  title={colour.name}
                  aria-label={colour.name}
                  onClick={() => setOption(index, { colourCode: colour.code })}
                  className={`h-5 w-5 rounded-full ${option.colourCode === colour.code ? "ring-2 ring-neutral-900 ring-offset-1 dark:ring-dark-1000" : ""}`}
                  style={{ backgroundColor: colour.code }}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="Quitar opción"
              disabled={draft.options.length <= 1}
              onClick={() =>
                onChange({
                  ...draft,
                  options: draft.options.filter((_, i) => i !== index),
                })
              }
              className="rounded p-1 text-neutral-500 hover:bg-light-200 disabled:opacity-30 dark:text-dark-900 dark:hover:bg-dark-200"
            >
              <HiXMark className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...draft,
            options: [...draft.options, { name: "", colourCode: "#9ca3af" }],
          })
        }
        className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-600 hover:underline dark:text-dark-900"
      >
        <HiPlus className="h-3 w-3" /> Agregar opción
      </button>

      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={!canSave || isSaving}
          isLoading={isSaving}
        >
          Guardar campo
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {draft.publicId && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-dark-900">
          Si quitás una opción, las tarjetas que la tenían vuelven a la primera
          opción y se borran las automatizaciones que la usaban.
        </p>
      )}
    </div>
  );
}

export default function BoardFieldsView() {
  const router = useRouter();
  const boardPublicId = Array.isArray(router.query.boardPublicId)
    ? router.query.boardPublicId[0]
    : router.query.boardPublicId;
  const enabled = !!boardPublicId && boardPublicId.length >= 12;
  const queryInput = { boardPublicId: boardPublicId ?? "" };

  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { canEditBoard } = usePermissions();

  const board = api.board.byId.useQuery(queryInput, { enabled });
  const fields = api.boardFields.all.useQuery(queryInput, { enabled });
  const automations = api.boardFields.automations.useQuery(queryInput, {
    enabled,
  });

  const [draft, setDraft] = useState<FieldDraft | null>(null);
  const emptyRule = {
    fieldPublicId: "",
    optionPublicId: "",
    action: "move" as "move" | "set",
    listPublicId: "",
    setFieldPublicId: "",
    setOptionPublicId: "",
  };
  const [rule, setRule] = useState(emptyRule);

  const showError = () =>
    showPopup({
      header: "No se pudo guardar",
      message: "Probá de nuevo en un rato.",
      icon: "error",
    });

  const refresh = async () => {
    await Promise.all([
      utils.boardFields.all.invalidate(queryInput),
      utils.boardFields.automations.invalidate(queryInput),
      utils.boardFields.forCard.invalidate(),
    ]);
  };

  const createField = api.boardFields.create.useMutation({
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: showError,
  });
  const updateField = api.boardFields.update.useMutation({
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: showError,
  });
  const deleteField = api.boardFields.delete.useMutation({
    onSuccess: refresh,
    onError: showError,
  });
  const reorderFields = api.boardFields.reorder.useMutation({
    onSuccess: refresh,
    onError: showError,
  });
  const createAutomation = api.boardFields.createAutomation.useMutation({
    onSuccess: async () => {
      setRule(emptyRule);
      await refresh();
    },
    onError: showError,
  });
  const updateAutomation = api.boardFields.updateAutomation.useMutation({
    onSuccess: refresh,
    onError: showError,
  });
  const deleteAutomation = api.boardFields.deleteAutomation.useMutation({
    onSuccess: refresh,
    onError: showError,
  });

  const saveDraft = () => {
    if (!draft || !boardPublicId) return;
    const options = draft.options.map((o) => ({
      publicId: o.publicId,
      name: o.name.trim(),
      colourCode: o.colourCode,
    }));

    if (draft.publicId)
      updateField.mutate({
        fieldPublicId: draft.publicId,
        name: draft.name.trim(),
        options,
      });
    else
      createField.mutate({
        boardPublicId,
        name: draft.name.trim(),
        options,
      });
  };

  const moveField = (index: number, direction: -1 | 1) => {
    if (!fields.data || !boardPublicId) return;
    const ids = fields.data.map((f) => f.publicId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderFields.mutate({ boardPublicId, fieldPublicIds: ids });
  };

  const lists = board.data?.lists ?? [];
  const ruleField = fields.data?.find((f) => f.publicId === rule.fieldPublicId);
  const ruleSetField = fields.data?.find(
    (f) => f.publicId === rule.setFieldPublicId,
  );
  const canAddRule =
    !!rule.fieldPublicId &&
    !!rule.optionPublicId &&
    (rule.action === "move"
      ? !!rule.listPublicId
      : !!rule.setFieldPublicId && !!rule.setOptionPublicId);

  const addRule = () => {
    if (!boardPublicId) return;
    const trigger = {
      boardPublicId,
      fieldPublicId: rule.fieldPublicId,
      optionPublicId: rule.optionPublicId,
    };
    createAutomation.mutate(
      rule.action === "move"
        ? { ...trigger, listPublicId: rule.listPublicId }
        : {
            ...trigger,
            setFieldPublicId: rule.setFieldPublicId,
            setOptionPublicId: rule.setOptionPublicId,
          },
    );
  };

  return (
    <>
      <PageHead
        title={`Campos y automatizaciones | ${board.data?.name ?? "Tablero"}`}
      />
      <div className="h-full overflow-y-auto">
        <div className="m-auto max-w-[900px] p-8 px-5 md:px-12 md:py-12">
          <Link
            href={`/boards/${boardPublicId ?? ""}`}
            className="mb-4 flex w-fit items-center gap-1 text-sm text-neutral-500 hover:underline dark:text-dark-900"
          >
            <HiArrowLeft className="h-4 w-4" /> Volver al tablero
          </Link>
          <h1 className="text-lg font-bold text-neutral-900 dark:text-dark-1000">
            Campos y automatizaciones
            {board.data?.name ? ` · ${board.data.name}` : ""}
          </h1>

          {!canEditBoard && (
            <p className="mt-4 text-sm text-neutral-500 dark:text-dark-900">
              Solo quien puede editar el tablero cambia esta configuración.
            </p>
          )}

          {/* Fields */}
          <h2 className={sectionTitleClass}>Campos</h2>
          <p className={helpClass}>
            Cada campo aparece en todas las tarjetas de este tablero como un
            desplegable.
          </p>

          <div className="space-y-2">
            {fields.data?.map((field, index) =>
              draft?.publicId === field.publicId ? (
                <FieldEditor
                  key={field.publicId}
                  draft={draft}
                  isSaving={updateField.isPending}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={() => setDraft(null)}
                />
              ) : (
                <div
                  key={field.publicId}
                  className="flex items-center gap-3 rounded-md border border-light-300 px-3 py-2 dark:border-dark-300"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900 dark:text-dark-1000">
                      {field.name}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {field.options.map((option) => (
                        <Badge
                          key={option.publicId}
                          value={option.name}
                          iconLeft={
                            <LabelIcon colourCode={option.colourCode} />
                          }
                        />
                      ))}
                    </div>
                  </div>
                  {canEditBoard && (
                    <div className="flex shrink-0 items-center gap-1 text-neutral-500 dark:text-dark-900">
                      <button
                        type="button"
                        aria-label="Subir"
                        disabled={index === 0 || reorderFields.isPending}
                        onClick={() => moveField(index, -1)}
                        className="rounded p-1 hover:bg-light-200 disabled:opacity-30 dark:hover:bg-dark-200"
                      >
                        <HiChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Bajar"
                        disabled={
                          index === (fields.data?.length ?? 0) - 1 ||
                          reorderFields.isPending
                        }
                        onClick={() => moveField(index, 1)}
                        className="rounded p-1 hover:bg-light-200 disabled:opacity-30 dark:hover:bg-dark-200"
                      >
                        <HiChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Editar campo"
                        onClick={() =>
                          setDraft({
                            publicId: field.publicId,
                            name: field.name,
                            options: field.options.map((o) => ({ ...o })),
                          })
                        }
                        className="rounded p-1 hover:bg-light-200 dark:hover:bg-dark-200"
                      >
                        <HiOutlinePencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Borrar campo"
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Borrar el campo "${field.name}"? También se borran sus automatizaciones.`,
                            )
                          )
                            deleteField.mutate({
                              fieldPublicId: field.publicId,
                            });
                        }}
                        className="rounded p-1 hover:bg-light-200 dark:hover:bg-dark-200"
                      >
                        <HiOutlineTrash className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
            {fields.data?.length === 0 && !draft && (
              <p className="text-sm text-neutral-500 dark:text-dark-900">
                Este tablero todavía no tiene campos.
              </p>
            )}
          </div>

          {canEditBoard &&
            (draft && !draft.publicId ? (
              <div className="mt-2">
                <FieldEditor
                  draft={draft}
                  isSaving={createField.isPending}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={() => setDraft(null)}
                />
              </div>
            ) : (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={<HiPlus className="h-4 w-4" />}
                  onClick={() =>
                    setDraft({
                      name: "",
                      options: DEFAULT_OPTIONS.map((o) => ({ ...o })),
                    })
                  }
                >
                  Nuevo campo
                </Button>
              </div>
            ))}

          {/* Automations */}
          <h2 className={`${sectionTitleClass} mt-12`}>Automatizaciones</h2>
          <p className={helpClass}>
            Cuando un campo de una tarjeta cambia a cierta opción, la tarjeta se
            mueve sola a una lista o cambia otro campo. Para hacer las dos
            cosas, armá dos reglas con el mismo &quot;Cuando&quot;.
          </p>

          <div className="space-y-2">
            {automations.data?.map((automation) => (
              <div
                key={automation.publicId}
                className={`flex flex-wrap items-center gap-2 rounded-md border border-light-300 px-3 py-2 text-sm text-neutral-900 dark:border-dark-300 dark:text-dark-1000 ${automation.isActive ? "" : "opacity-50"}`}
              >
                <span>Cuando</span>
                <strong>{automation.field.name}</strong>
                <span>pasa a</span>
                <Badge
                  value={automation.option.name}
                  iconLeft={
                    <LabelIcon colourCode={automation.option.colourCode} />
                  }
                />
                {automation.list ? (
                  <>
                    <span>→ mover a</span>
                    <strong>{automation.list.name}</strong>
                  </>
                ) : (
                  <>
                    <span>→ cambiar</span>
                    <strong>{automation.setField?.name}</strong>
                    <span>a</span>
                    {automation.setOption && (
                      <Badge
                        value={automation.setOption.name}
                        iconLeft={
                          <LabelIcon
                            colourCode={automation.setOption.colourCode}
                          />
                        }
                      />
                    )}
                  </>
                )}
                {canEditBoard && (
                  <div className="ml-auto flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1 text-xs text-neutral-600 dark:text-dark-900">
                      <input
                        type="checkbox"
                        checked={automation.isActive}
                        onChange={(e) =>
                          updateAutomation.mutate({
                            automationPublicId: automation.publicId,
                            isActive: e.target.checked,
                          })
                        }
                      />
                      Activa
                    </label>
                    <button
                      type="button"
                      aria-label="Borrar automatización"
                      onClick={() => {
                        if (window.confirm("¿Borrar esta automatización?"))
                          deleteAutomation.mutate({
                            automationPublicId: automation.publicId,
                          });
                      }}
                      className="rounded p-1 text-neutral-500 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
                    >
                      <HiOutlineTrash className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {automations.data?.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-dark-900">
                Todavía no hay automatizaciones.
              </p>
            )}
          </div>

          {canEditBoard && (
            <div className="mt-4 rounded-md border border-light-300 p-4 dark:border-dark-300">
              <p className="mb-3 text-sm font-medium text-neutral-900 dark:text-dark-1000">
                Nueva automatización
              </p>
              {fields.data?.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-dark-900">
                  Primero creá un campo.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-900 dark:text-dark-1000">
                  <span>Cuando</span>
                  <select
                    className={`${inputClass} w-auto`}
                    value={rule.fieldPublicId}
                    onChange={(e) =>
                      setRule({
                        ...rule,
                        fieldPublicId: e.target.value,
                        optionPublicId: "",
                        ...(rule.setFieldPublicId === e.target.value && {
                          setFieldPublicId: "",
                          setOptionPublicId: "",
                        }),
                      })
                    }
                  >
                    <option value="">elegí un campo</option>
                    {fields.data?.map((f) => (
                      <option key={f.publicId} value={f.publicId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <span>pasa a</span>
                  <select
                    className={`${inputClass} w-auto`}
                    value={rule.optionPublicId}
                    disabled={!ruleField}
                    onChange={(e) =>
                      setRule({ ...rule, optionPublicId: e.target.value })
                    }
                  >
                    <option value="">elegí una opción</option>
                    {ruleField?.options.map((o) => (
                      <option key={o.publicId} value={o.publicId}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <span>→</span>
                  <select
                    className={`${inputClass} w-auto`}
                    value={rule.action}
                    onChange={(e) =>
                      setRule({
                        ...rule,
                        action: e.target.value as "move" | "set",
                      })
                    }
                  >
                    <option value="move">mover la tarjeta a</option>
                    <option value="set">cambiar el campo</option>
                  </select>
                  {rule.action === "move" ? (
                    <select
                      className={`${inputClass} w-auto`}
                      value={rule.listPublicId}
                      onChange={(e) =>
                        setRule({ ...rule, listPublicId: e.target.value })
                      }
                    >
                      <option value="">elegí una lista</option>
                      {lists.map((l) => (
                        <option key={l.publicId} value={l.publicId}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select
                        className={`${inputClass} w-auto`}
                        value={rule.setFieldPublicId}
                        onChange={(e) =>
                          setRule({
                            ...rule,
                            setFieldPublicId: e.target.value,
                            setOptionPublicId: "",
                          })
                        }
                      >
                        <option value="">elegí un campo</option>
                        {fields.data
                          ?.filter((f) => f.publicId !== rule.fieldPublicId)
                          .map((f) => (
                            <option key={f.publicId} value={f.publicId}>
                              {f.name}
                            </option>
                          ))}
                      </select>
                      <span>a</span>
                      <select
                        className={`${inputClass} w-auto`}
                        value={rule.setOptionPublicId}
                        disabled={!ruleSetField}
                        onChange={(e) =>
                          setRule({
                            ...rule,
                            setOptionPublicId: e.target.value,
                          })
                        }
                      >
                        <option value="">elegí una opción</option>
                        {ruleSetField?.options.map((o) => (
                          <option key={o.publicId} value={o.publicId}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <Button
                    size="sm"
                    disabled={!canAddRule || createAutomation.isPending}
                    isLoading={createAutomation.isPending}
                    onClick={addRule}
                  >
                    Agregar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
