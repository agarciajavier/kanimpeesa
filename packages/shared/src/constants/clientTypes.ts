// Impeesa: what Impeesa does for the client. Gestión = Impeesa runs the
// accounts; Asesoría = Impeesa advises and the client runs them.
export const clientTypes = ["management", "advisory"] as const;

export type ClientType = (typeof clientTypes)[number];

export const clientTypeDetails: Record<ClientType, { name: string }> = {
  management: { name: "Gestión" },
  advisory: { name: "Asesoría" },
};
