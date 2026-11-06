// Impeesa: how each client is doing. The client's colour on the board comes
// from its status, so a glance at the dot says which clients need attention.
export const clientStatuses = [
  "starting",
  "ok",
  "at_risk",
  "critical",
  "paused",
  "lost",
] as const;

export type ClientStatus = (typeof clientStatuses)[number];

export const clientStatusDetails: Record<
  ClientStatus,
  { name: string; colourCode: string }
> = {
  starting: { name: "Iniciando", colourCode: "#0ea5e9" },
  ok: { name: "Correcto", colourCode: "#16a34a" },
  at_risk: { name: "En riesgo", colourCode: "#eab308" },
  critical: { name: "Crítico", colourCode: "#dc2626" },
  // Stopped for a while, expected back.
  paused: { name: "En pausa", colourCode: "#8b5cf6" },
  // Left Impeesa.
  lost: { name: "Perdido", colourCode: "#6b7280" },
};
