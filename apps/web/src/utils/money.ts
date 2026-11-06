// Impeesa: money as shown on the Clients and Stats pages. "$ 1.500.000" for
// pesos, "US$ 1.500" for dollars, no decimals.
export const formatMoney = (amount: number, currency: string | null) => {
  const prefix = currency === "USD" ? "US$" : "$";
  return `${prefix} ${Math.round(amount).toLocaleString("es-AR")}`;
};

// Several currencies can't be added up without an exchange rate, so totals
// are kept per currency: "$ 3.200.000 + US$ 1.500".
export const sumByCurrency = (
  rows: { amount: number | null; currency: string | null }[],
) => {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === null) continue;
    const currency = row.currency ?? "ARS";
    totals.set(currency, (totals.get(currency) ?? 0) + row.amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => ({ currency, amount }));
};

export const formatTotals = (totals: { currency: string; amount: number }[]) =>
  totals.length === 0
    ? "–"
    : totals.map((t) => formatMoney(t.amount, t.currency)).join(" + ");
