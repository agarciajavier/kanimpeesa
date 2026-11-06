import Link from "next/link";
import { useEffect, useState } from "react";
import { HiPlay, HiStop } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import LabelIcon from "./LabelIcon";

// Impeesa: time tracking. One timer per person: starting one on a card stops
// whatever was running. The timer lives in the database, so it keeps going
// if the tab is closed and shows on any device.

// "1 h 05 m", "25 m", "40 s"
export const formatDuration = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m`;
  if (m > 0) return `${m} m`;
  return `${seconds} s`;
};

// "1:05:09" / "5:09", for a running timer
export const formatClock = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
};

// Seconds since a date, updated every second while there is one.
export const useElapsed = (startedAt: Date | null | undefined) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return startedAt ? (now - new Date(startedAt).getTime()) / 1000 : 0;
};

export const useTimeTracker = () => {
  const utils = api.useUtils();
  const { showPopup } = usePopup();

  const running = api.timeEntries.running.useQuery(undefined, {
    // Picks up a timer started or stopped on another device.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const refresh = () =>
    Promise.all([
      utils.timeEntries.running.invalidate(),
      utils.timeEntries.forCard.invalidate(),
      utils.timeEntries.boardTotals.invalidate(),
    ]);

  const showError = () =>
    showPopup({
      header: "No se pudo actualizar el cronómetro",
      message: "Probá de nuevo en un momento.",
      icon: "error",
    });

  const start = api.timeEntries.start.useMutation({
    onSuccess: refresh,
    onError: showError,
  });
  const stop = api.timeEntries.stop.useMutation({
    onSuccess: refresh,
    onError: showError,
  });

  return {
    running: running.data ?? null,
    isBusy: start.isPending || stop.isPending,
    start: (cardPublicId: string) => start.mutate({ cardPublicId }),
    stop: () => stop.mutate(),
  };
};

// Play / stop button for a card. While the card's timer runs, it shows the
// time counting up.
export function TimerButton({
  cardPublicId,
  size = "md",
  className,
}: {
  cardPublicId: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { running, isBusy, start, stop } = useTimeTracker();
  const isRunningHere = running?.cardPublicId === cardPublicId;
  const elapsed = useElapsed(isRunningHere ? running.startedAt : null);

  return (
    <button
      type="button"
      disabled={isBusy}
      title={
        isRunningHere
          ? "Parar el cronómetro"
          : running
            ? "Empezar acá (para el cronómetro de la otra tarea)"
            : "Empezar a contar el tiempo"
      }
      // The board card is a draggable link: keep the click (and the drag
      // start) on the button.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRunningHere) stop();
        else start(cardPublicId);
      }}
      className={twMerge(
        "flex shrink-0 items-center gap-1 rounded-full font-medium transition-colors disabled:opacity-60",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        isRunningHere
          ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400"
          : "text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-300",
        className,
      )}
    >
      {isRunningHere ? (
        <HiStop className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      ) : (
        <HiPlay className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      )}
      {isRunningHere ? (
        <span className="tabular-nums">{formatClock(elapsed)}</span>
      ) : size === "md" ? (
        <span>Empezar</span>
      ) : null}
    </button>
  );
}

// Floating bar with the running timer, on every page of the dashboard.
export function RunningTimerBar() {
  const { running, isBusy, stop } = useTimeTracker();
  const elapsed = useElapsed(running?.startedAt);

  if (!running) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border border-light-300 bg-light-50 py-1.5 pl-4 pr-1.5 text-sm shadow-lg dark:border-dark-400 dark:bg-dark-200">
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
      <Link
        href={`/cards/${running.cardPublicId}`}
        className="flex min-w-0 flex-col leading-tight hover:underline"
      >
        {running.clientName && (
          <span className="flex items-center gap-1 text-[11px] text-light-900 dark:text-dark-900">
            <LabelIcon colourCode={running.clientColourCode} />
            {running.clientName}
          </span>
        )}
        <span className="max-w-[220px] truncate text-light-1000 dark:text-dark-1000">
          {running.cardTitle}
        </span>
      </Link>
      <span className="font-medium tabular-nums text-light-1000 dark:text-dark-1000">
        {formatClock(elapsed)}
      </span>
      <button
        type="button"
        disabled={isBusy}
        onClick={stop}
        title="Parar el cronómetro"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
      >
        <HiStop className="h-4 w-4" />
      </button>
    </div>
  );
}
