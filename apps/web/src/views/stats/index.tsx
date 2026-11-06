import Link from "next/link";
import { addMonths, format, isSameMonth, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { useMemo, useState } from "react";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi2";

import Avatar from "~/components/Avatar";
import LabelIcon from "~/components/LabelIcon";
import { PageHead } from "~/components/PageHead";
import { formatDuration } from "~/components/TimeTracker";
import { usePermissions } from "~/hooks/usePermissions";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { getAvatarUrl } from "~/utils/helpers";
import { formatMoney, formatTotals, sumByCurrency } from "~/utils/money";

// Impeesa: hours by client, person and task for a calendar month and, with
// "finance:view", what each client pays, costs and leaves per hour.
//
// The traffic light compares the client's monthly cost with its fee:
// red above 70%, yellow from 50% to 70%, green below 50%.

const NO_CLIENT_COLOUR = "#9ca3af";

type Light = "red" | "yellow" | "green" | "none";

const LIGHTS: Record<Light, { colour: string; label: string }> = {
  red: { colour: "#ef4444", label: "El costo pasa el 70% del fee" },
  yellow: { colour: "#eab308", label: "El costo está entre el 50% y el 70% del fee" },
  green: { colour: "#22c55e", label: "El costo está por debajo del 50% del fee" },
  none: { colour: "#d1d5db", label: "Falta cargar fee o costo" },
};

const lightFor = (costShare: number | null): Light =>
  costShare === null
    ? "none"
    : costShare > 0.7
      ? "red"
      : costShare >= 0.5
        ? "yellow"
        : "green";

const hoursText = (seconds: number) =>
  seconds === 0 ? "0 h" : formatDuration(seconds);

const formatHoursNumber = (hours: number) =>
  `${hours.toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100">
      <p className="text-xs text-light-900 dark:text-dark-900">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900 dark:text-dark-1000">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-light-800 dark:text-dark-800">{hint}</p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-medium text-neutral-900 dark:text-dark-1000">
        {title}
      </h2>
      {hint && (
        <p className="mt-1 text-xs text-light-900 dark:text-dark-900">{hint}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// Worked vs agreed hours; turns red past 100%.
function UsageBar({
  seconds,
  contractedHours,
}: {
  seconds: number;
  contractedHours: number | null;
}) {
  if (!contractedHours) return null;
  const share = seconds / 3600 / contractedHours;
  return (
    <div
      className="mt-1 h-1.5 w-full rounded-full bg-light-300 dark:bg-dark-400"
      title={`${Math.round(share * 100)}% de las horas pactadas`}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(share, 1) * 100}%`,
          backgroundColor: share > 1 ? "#ef4444" : "#3b82f6",
        }}
      />
    </div>
  );
}

export default function StatsView() {
  const { workspace } = useWorkspace();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canSeeStats = hasPermission("time:view");

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const isCurrentMonth = isSameMonth(month, new Date());

  const stats = api.timeEntries.summary.useQuery(
    {
      workspacePublicId: workspace.publicId,
      from: month,
      to: addMonths(month, 1),
    },
    {
      enabled:
        canSeeStats &&
        !!workspace.publicId &&
        workspace.publicId.length >= 12,
    },
  );

  const data = stats.data;
  const finance = !!data?.canSeeFinance;

  const clients = useMemo(() => {
    if (!data) return [];
    return data.byClient.map((c) => {
      const hours = c.seconds / 3600;
      const costShare =
        c.monthlyFee && c.monthlyFee > 0 && c.monthlyCost !== null
          ? c.monthlyCost / c.monthlyFee
          : null;
      const profit =
        c.monthlyFee !== null ? c.monthlyFee - (c.monthlyCost ?? 0) : null;
      return {
        ...c,
        hours,
        costShare,
        profit,
        // What each worked hour leaves after paying third parties.
        profitPerHour: profit !== null && hours > 0 ? profit / hours : null,
        light: lightFor(costShare),
      };
    });
  }, [data]);

  const sortedClients = useMemo(() => {
    const rows = [...clients];
    if (finance) {
      // Worst first: highest cost share, then least left per hour. Clients
      // without numbers, and time without a client, go last.
      const rank = (c: (typeof rows)[number]) =>
        c.clientPublicId === null ? 3 : c.costShare === null ? 2 : 1;
      rows.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (b.costShare ?? 0) - (a.costShare ?? 0) ||
          (a.profitPerHour ?? Infinity) - (b.profitPerHour ?? Infinity) ||
          b.seconds - a.seconds,
      );
    } else {
      rows.sort(
        (a, b) =>
          Number(a.clientPublicId === null) -
            Number(b.clientPublicId === null) || b.seconds - a.seconds,
      );
    }
    return rows;
  }, [clients, finance]);

  const clientByPublicId = useMemo(
    () => new Map(clients.map((c) => [c.clientPublicId, c])),
    [clients],
  );

  // Money tiles: per currency, since there's no exchange rate.
  const billed = sumByCurrency(
    clients.map((c) => ({ amount: c.monthlyFee, currency: c.feeCurrency })),
  );
  const left = sumByCurrency(
    clients.map((c) => ({ amount: c.profit, currency: c.feeCurrency })),
  );
  const perHour = left
    .map((t) => {
      const hours = clients
        .filter(
          (c) => c.profit !== null && (c.feeCurrency ?? "ARS") === t.currency,
        )
        .reduce((acc, c) => acc + c.hours, 0);
      return hours > 0
        ? formatMoney(t.amount / hours, t.currency)
        : null;
    })
    .filter(Boolean)
    .join(" + ");

  const monthLabel = format(month, "MMMM yyyy", { locale: es });

  if (!permissionsLoading && !canSeeStats)
    return (
      <div className="p-8 text-sm text-light-900 dark:text-dark-900">
        No tenés permiso para ver las estadísticas. Pedíselo a un admin.
      </div>
    );

  return (
    <>
      <PageHead title={`Estadísticas | ${workspace.name ?? "Workspace"}`} />
      <div className="h-full overflow-y-auto">
        <div className="m-auto max-w-[1100px] p-8 px-4 md:px-12 md:py-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-bold tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
              Estadísticas
            </h1>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Mes anterior"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="rounded-md p-1.5 text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
              >
                <HiChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[140px] text-center text-sm font-medium capitalize text-neutral-900 dark:text-dark-1000">
                {monthLabel}
              </span>
              <button
                type="button"
                aria-label="Mes siguiente"
                disabled={isCurrentMonth}
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="rounded-md p-1.5 text-light-900 hover:bg-light-200 disabled:opacity-30 dark:text-dark-900 dark:hover:bg-dark-200"
              >
                <HiChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isCurrentMonth && finance && (
            <p className="mt-2 text-xs text-light-900 dark:text-dark-900">
              El mes todavía no terminó: el fee es del mes entero pero las
              horas siguen sumando, así que lo que deja cada hora va a bajar.
            </p>
          )}

          {(stats.isLoading || permissionsLoading) && (
            <div className="mt-6 h-24 w-full animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
          )}

          {data && (
            <>
              <div
                className={`mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 ${finance ? "lg:grid-cols-4" : ""}`}
              >
                <Tile
                  label="Horas trabajadas"
                  value={hoursText(data.totalSeconds)}
                  hint={`${data.byUser.length} ${data.byUser.length === 1 ? "persona" : "personas"}`}
                />
                {finance && (
                  <>
                    <Tile
                      label="Facturado en el mes"
                      value={formatTotals(billed)}
                      hint="Suma de los fees cargados"
                    />
                    <Tile
                      label="Te queda después de pagar costos"
                      value={formatTotals(left)}
                      hint="Fees menos costos"
                    />
                    <Tile
                      label="Cada hora te deja"
                      value={perHour || "–"}
                      hint="Lo que te queda ÷ horas de esos clientes"
                    />
                  </>
                )}
              </div>

              <Section
                title="Por cliente"
                hint={
                  finance
                    ? "Arriba, los que menos te convienen. Semáforo: rojo si el costo pasa el 70% del fee, amarillo entre 50% y 70%, verde por debajo."
                    : undefined
                }
              >
                <div className="overflow-x-auto rounded-md border border-light-300 dark:border-dark-300">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-light-200 text-xs text-light-900 dark:bg-dark-200 dark:text-dark-900">
                      <tr>
                        <th className="px-3 py-2 font-medium">Cliente</th>
                        <th className="px-3 py-2 font-medium">Horas</th>
                        {finance && (
                          <>
                            <th className="px-3 py-2 text-right font-medium">
                              Fee
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              Costo
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              Te queda
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              Cada hora te deja
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-light-300 dark:divide-dark-300">
                      {sortedClients.length === 0 && (
                        <tr>
                          <td
                            colSpan={finance ? 6 : 2}
                            className="px-3 py-4 text-light-900 dark:text-dark-900"
                          >
                            No hay clientes ni horas este mes.
                          </td>
                        </tr>
                      )}
                      {sortedClients.map((c) => (
                        <tr key={c.clientPublicId ?? "none"}>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2 text-neutral-900 dark:text-dark-1000">
                              {finance && c.clientPublicId !== null ? (
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: LIGHTS[c.light].colour,
                                  }}
                                  title={LIGHTS[c.light].label}
                                />
                              ) : (
                                <LabelIcon
                                  colourCode={c.colourCode ?? NO_CLIENT_COLOUR}
                                />
                              )}
                              {c.name ?? "Sin cliente (interno)"}
                            </span>
                          </td>
                          <td className="min-w-[150px] px-3 py-2 tabular-nums text-neutral-900 dark:text-dark-1000">
                            {hoursText(c.seconds)}
                            {c.contractedHours ? (
                              <span className="text-light-900 dark:text-dark-900">
                                {" "}
                                de {formatHoursNumber(c.contractedHours)}
                              </span>
                            ) : null}
                            <UsageBar
                              seconds={c.seconds}
                              contractedHours={c.contractedHours}
                            />
                          </td>
                          {finance && (
                            <>
                              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                {c.monthlyFee !== null
                                  ? formatMoney(c.monthlyFee, c.feeCurrency)
                                  : "–"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                {c.monthlyCost !== null
                                  ? formatMoney(c.monthlyCost, c.feeCurrency)
                                  : "–"}
                                {c.costShare !== null && (
                                  <span className="block text-xs text-light-900 dark:text-dark-900">
                                    {Math.round(c.costShare * 100)}% del fee
                                  </span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                {c.profit !== null
                                  ? formatMoney(c.profit, c.feeCurrency)
                                  : "–"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                                {c.profitPerHour !== null
                                  ? formatMoney(c.profitPerHour, c.feeCurrency)
                                  : c.profit !== null
                                    ? "sin horas"
                                    : "–"}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {finance && (
                  <p className="mt-2 text-xs text-light-900 dark:text-dark-900">
                    El fee, el costo y las horas pactadas se cargan en{" "}
                    <Link href="/clients" className="underline">
                      Clientes
                    </Link>
                    .
                  </p>
                )}
              </Section>

              <Section title="Por persona">
                {data.byUser.length === 0 ? (
                  <p className="text-sm text-light-900 dark:text-dark-900">
                    Nadie cargó horas este mes.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {[...data.byUser]
                      .sort((a, b) => b.seconds - a.seconds)
                      .map((u) => {
                        const parts = data.byUserAndClient
                          .filter((r) => r.userId === u.userId)
                          .sort((a, b) => b.seconds - a.seconds);
                        return (
                          <div key={u.userId}>
                            <div className="flex items-center gap-2 text-sm">
                              <Avatar
                                name={u.name ?? ""}
                                email={u.email}
                                imageUrl={
                                  u.image ? getAvatarUrl(u.image) : undefined
                                }
                                size="xs"
                              />
                              <span className="flex-1 truncate text-neutral-900 dark:text-dark-1000">
                                {u.name ?? u.email}
                              </span>
                              <span className="tabular-nums text-neutral-900 dark:text-dark-1000">
                                {hoursText(u.seconds)}
                              </span>
                            </div>
                            {/* How the person's time splits across clients */}
                            <div className="mt-1.5 flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
                              {parts.map((p) => {
                                const client = clientByPublicId.get(
                                  p.clientPublicId,
                                );
                                return (
                                  <div
                                    key={p.clientPublicId ?? "none"}
                                    className="h-full"
                                    style={{
                                      width: `${(p.seconds / u.seconds) * 100}%`,
                                      backgroundColor:
                                        client?.colourCode ?? NO_CLIENT_COLOUR,
                                    }}
                                    title={`${client?.name ?? "Sin cliente"}: ${hoursText(p.seconds)}`}
                                  />
                                );
                              })}
                            </div>
                            <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
                              {parts
                                .map(
                                  (p) =>
                                    `${clientByPublicId.get(p.clientPublicId)?.name ?? "Sin cliente"} ${hoursText(p.seconds)}`,
                                )
                                .join(" · ")}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                )}
              </Section>

              <Section title="Las tareas que más tiempo llevaron">
                {data.topCards.length === 0 ? (
                  <p className="text-sm text-light-900 dark:text-dark-900">
                    Todavía no hay tareas con horas este mes.
                  </p>
                ) : (
                  <ol className="divide-y divide-light-300 rounded-md border border-light-300 dark:divide-dark-300 dark:border-dark-300">
                    {data.topCards.map((card, index) => {
                      const client = clientByPublicId.get(card.clientPublicId);
                      return (
                        <li
                          key={`${card.cardPublicId}-${card.clientPublicId ?? "none"}`}
                          className="flex items-center gap-3 px-3 py-2 text-sm"
                        >
                          <span className="w-5 shrink-0 text-right text-xs text-light-800 dark:text-dark-800">
                            {index + 1}
                          </span>
                          <Link
                            href={`/cards/${card.cardPublicId}`}
                            className="min-w-0 flex-1 truncate text-neutral-900 hover:underline dark:text-dark-1000"
                          >
                            {card.title}
                          </Link>
                          <span className="hidden shrink-0 items-center gap-1 text-xs text-light-900 dark:text-dark-900 sm:flex">
                            <LabelIcon
                              colourCode={
                                client?.colourCode ?? NO_CLIENT_COLOUR
                              }
                            />
                            {client?.name ?? "Sin cliente"}
                          </span>
                          <span className="shrink-0 tabular-nums text-neutral-900 dark:text-dark-1000">
                            {hoursText(card.seconds)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
