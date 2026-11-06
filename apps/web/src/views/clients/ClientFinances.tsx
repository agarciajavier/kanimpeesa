import { useState } from "react";
import { HiOutlineBanknotes, HiOutlinePencil } from "react-icons/hi2";

import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { formatMoney } from "~/utils/money";

// Impeesa: a client's monthly fee, monthly cost (what is paid to third
// parties for working on the client) and agreed monthly hours, on the
// Clients page. Only rendered for people with "finance:view".

export interface ClientFinance {
  clientPublicId: string;
  monthlyFee: number | null;
  monthlyCost: number | null;
  feeCurrency: "ARS" | "USD";
  contractedHours: number | null;
}

const inputClass =
  "block w-full rounded-md border-0 bg-white/5 px-3 py-1.5 text-sm text-neutral-900 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700";

// "1.500.000", "1500000,50", "1.5" or "20" → number; empty → null. Dots are
// thousands separators when there's a comma or groups of three digits after
// them; otherwise a dot is the decimal point.
const parseAmount = (text: string) => {
  const raw = text.trim().replace(/\s|\$|US/g, "");
  const dotsAreThousands = raw.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(raw);
  const clean = dotsAreThousands
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

const toText = (n: number | null) =>
  n === null ? "" : n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

export default function ClientFinances({
  workspacePublicId,
  clientPublicId,
  finance,
}: {
  workspacePublicId: string;
  clientPublicId: string;
  finance: ClientFinance | undefined;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [isEditing, setIsEditing] = useState(false);
  const [fee, setFee] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [hours, setHours] = useState("");

  const save = api.clients.updateFinances.useMutation({
    onSuccess: async () => {
      setIsEditing(false);
      await utils.clients.finances.invalidate({ workspacePublicId });
      await utils.timeEntries.summary.invalidate();
    },
    onError: () =>
      showPopup({
        header: "No se pudo guardar",
        message: "Revisá que los montos sean números.",
        icon: "error",
      }),
  });

  const open = () => {
    setFee(toText(finance?.monthlyFee ?? null));
    setCost(toText(finance?.monthlyCost ?? null));
    setCurrency(finance?.feeCurrency ?? "ARS");
    setHours(toText(finance?.contractedHours ?? null));
    setIsEditing(true);
  };

  const submit = () => {
    const monthlyFee = parseAmount(fee);
    const monthlyCost = parseAmount(cost);
    const contractedHours = parseAmount(hours);
    if ([monthlyFee, monthlyCost, contractedHours].some((n) => Number.isNaN(n)))
      return showPopup({
        header: "Hay un número que no se entiende",
        message: "Escribí solo números, por ejemplo 1.500.000",
        icon: "error",
      });
    save.mutate({
      clientPublicId,
      monthlyFee,
      monthlyCost,
      feeCurrency: currency,
      contractedHours,
    });
  };

  if (isEditing)
    return (
      <div className="mt-3 space-y-2 rounded-md border border-light-300 p-3 dark:border-dark-300">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-light-900 dark:text-dark-900">
            Fee mensual
            <div className="mt-1 flex gap-1">
              <select
                className={`${inputClass} w-24`}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "ARS" | "USD")}
              >
                <option value="ARS">$</option>
                <option value="USD">US$</option>
              </select>
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder="1.500.000"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                autoFocus
              />
            </div>
          </label>
          <label className="text-xs text-light-900 dark:text-dark-900">
            Costo mensual (lo que pagás a terceros por este cliente)
            <input
              className={`${inputClass} mt-1`}
              inputMode="decimal"
              placeholder="400.000"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label className="text-xs text-light-900 dark:text-dark-900">
            Horas pactadas por mes
            <input
              className={`${inputClass} mt-1`}
              inputMode="decimal"
              placeholder="20"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={submit}
            isLoading={save.isPending}
            disabled={save.isPending}
          >
            Guardar
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsEditing(false)}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );

  const parts: string[] = [];
  if (finance?.monthlyFee != null)
    parts.push(`Fee ${formatMoney(finance.monthlyFee, finance.feeCurrency)}`);
  if (finance?.monthlyCost != null) {
    const share =
      finance.monthlyFee && finance.monthlyFee > 0
        ? ` (${Math.round((finance.monthlyCost / finance.monthlyFee) * 100)}% del fee)`
        : "";
    parts.push(
      `Costo ${formatMoney(finance.monthlyCost, finance.feeCurrency)}${share}`,
    );
  }
  if (finance?.contractedHours != null)
    parts.push(`${toText(finance.contractedHours)} h pactadas por mes`);

  return (
    <button
      type="button"
      onClick={open}
      className="group mt-2 flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-light-900 hover:bg-light-100 dark:text-dark-900 dark:hover:bg-dark-200"
    >
      <HiOutlineBanknotes className="h-4 w-4 shrink-0" />
      <span>
        {parts.length > 0 ? parts.join(" · ") : "Cargar fee, costo y horas"}
      </span>
      <HiOutlinePencil className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
    </button>
  );
}
