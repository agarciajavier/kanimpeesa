import { format } from "date-fns";
import { useState } from "react";
import { HiOutlineTrash, HiPlus } from "react-icons/hi2";

import Avatar from "~/components/Avatar";
import Button from "~/components/Button";
import {
  formatDuration,
  TimerButton,
  useElapsed,
} from "~/components/TimeTracker";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { getAvatarUrl } from "~/utils/helpers";

// Impeesa: the time logged on a card: total, who logged what, and a form to
// add time by hand (for when the timer was forgotten).

const inputClass =
  "block w-full rounded-md border-0 bg-white/5 px-3 py-1.5 text-sm text-neutral-900 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700";

const toLocalInput = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

export default function CardTimeEntries({
  cardPublicId,
  viewOnly,
}: {
  cardPublicId: string;
  viewOnly: boolean;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { dateLocale } = useLocalisation();

  const entries = api.timeEntries.forCard.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12 },
  );

  const [isAdding, setIsAdding] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [note, setNote] = useState("");

  const refresh = () =>
    Promise.all([
      utils.timeEntries.forCard.invalidate({ cardPublicId }),
      utils.timeEntries.boardTotals.invalidate(),
    ]);

  const addManual = api.timeEntries.addManual.useMutation({
    onSuccess: async () => {
      setIsAdding(false);
      setHours("");
      setMinutes("");
      setNote("");
      await refresh();
    },
    onError: () =>
      showPopup({
        header: "No se pudo cargar el tiempo",
        message: "Revisá la duración y que la fecha no sea a futuro.",
        icon: "error",
      }),
  });

  const deleteEntry = api.timeEntries.delete.useMutation({
    onSuccess: refresh,
    onError: () =>
      showPopup({
        header: "No se pudo borrar",
        message: "Probá de nuevo en un momento.",
        icon: "error",
      }),
  });

  const list = entries.data ?? [];
  const running = list.find((e) => !e.endedAt);
  // Re-renders every second while someone's timer runs on this card.
  useElapsed(running?.startedAt);

  const secondsOf = (e: { startedAt: Date; endedAt: Date | null }) =>
    ((e.endedAt ?? new Date()).getTime() - e.startedAt.getTime()) / 1000;
  const total = list.reduce((acc, e) => acc + secondsOf(e), 0);

  const totalMinutes =
    (parseInt(hours || "0", 10) || 0) * 60 +
    (parseInt(minutes || "0", 10) || 0);

  const openForm = () => {
    setStartedAt(toLocalInput(new Date(Date.now() - 60 * 60_000)));
    setIsAdding(true);
  };

  const submit = () => {
    if (totalMinutes < 1 || !startedAt) return;
    addManual.mutate({
      cardPublicId,
      startedAt: new Date(startedAt),
      minutes: totalMinutes,
      note: note.trim() || undefined,
    });
  };

  if (!entries.data || (viewOnly && list.length === 0)) return null;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium text-light-1000 dark:text-dark-1000">
          Tiempo
          {list.length > 0 && (
            <span className="ml-2 text-sm font-normal text-light-900 dark:text-dark-900">
              {formatDuration(total)} en total
            </span>
          )}
        </p>
        {!viewOnly && <TimerButton cardPublicId={cardPublicId} />}
      </div>

      {list.map((entry) => (
        <div
          key={entry.publicId}
          className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-light-100 dark:hover:bg-dark-100"
        >
          <Avatar
            name={entry.user.name ?? ""}
            email={entry.user.email}
            imageUrl={
              entry.user.image ? getAvatarUrl(entry.user.image) : undefined
            }
            size="xs"
          />
          <span className="min-w-0 flex-1 truncate text-light-1000 dark:text-dark-1000">
            {entry.user.name ?? entry.user.email}
            <span className="ml-2 text-light-900 dark:text-dark-900">
              {format(entry.startedAt, "d MMM, HH:mm", { locale: dateLocale })}
              {entry.source === "manual" && " · a mano"}
              {entry.note && ` · ${entry.note}`}
            </span>
          </span>
          <span
            className={
              entry.endedAt
                ? "shrink-0 tabular-nums text-light-1000 dark:text-dark-1000"
                : "shrink-0 tabular-nums text-red-600 dark:text-red-400"
            }
          >
            {entry.endedAt
              ? formatDuration(secondsOf(entry))
              : `en curso · ${formatDuration(secondsOf(entry))}`}
          </span>
          {entry.isMine && entry.endedAt && (
            <button
              type="button"
              aria-label="Borrar este registro"
              onClick={() => {
                if (window.confirm("¿Borrar este registro de tiempo?"))
                  deleteEntry.mutate({ entryPublicId: entry.publicId });
              }}
              className="shrink-0 rounded-md p-1 text-light-900 opacity-0 hover:bg-light-200 group-hover:opacity-100 dark:text-dark-900 dark:hover:bg-dark-200"
            >
              <HiOutlineTrash className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}

      {!viewOnly &&
        (isAdding ? (
          <div className="mt-2 space-y-2 rounded-md border border-light-300 p-3 dark:border-dark-300">
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} w-20`}
                type="number"
                min={0}
                placeholder="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                autoFocus
              />
              <span className="text-sm text-light-900 dark:text-dark-900">
                horas
              </span>
              <input
                className={`${inputClass} w-20`}
                type="number"
                min={0}
                max={59}
                placeholder="0"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <span className="text-sm text-light-900 dark:text-dark-900">
                minutos
              </span>
            </div>
            <label className="block text-xs text-light-900 dark:text-dark-900">
              Cuándo empezó
              <input
                className={`${inputClass} mt-1`}
                type="datetime-local"
                value={startedAt}
                max={toLocalInput(new Date())}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </label>
            <input
              className={inputClass}
              placeholder="Nota (opcional)"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={submit}
                disabled={totalMinutes < 1 || addManual.isPending}
                isLoading={addManual.isPending}
              >
                Cargar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsAdding(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openForm}
            className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-sm text-light-900 hover:bg-light-100 dark:text-dark-900 dark:hover:bg-dark-100"
          >
            <HiPlus className="h-4 w-4" /> Cargar tiempo a mano
          </button>
        ))}
    </div>
  );
}
