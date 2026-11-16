import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";
import { HiArrowPath, HiPlus } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

// Impeesa: the "Forms" section. "Nuevo cliente" registers a client (card on
// the Onboarding board + welcome email with the link to the administrative
// form) and each client shows, step by step, what has been done.

type OnboardingClient = RouterOutputs["onboarding"]["list"]["clients"][number];
type Job = OnboardingClient["jobs"][number];

// The steps shown, in order. A step may be several jobs.
// The card's field following Resend's notices (onboarding/handlers.ts).
const emailFieldKinds = (emailKind: string) =>
  ["Entregado", "Abierto", "Rebotó"].map(
    (option) => `email_field:${emailKind}:${option}`,
  );

const STEPS: { label: string; kinds: string[] }[] = [
  {
    label: "Mail de bienvenida",
    kinds: [
      "welcome_email",
      "field:welcome_sent",
      ...emailFieldKinds("bienvenida"),
    ],
  },
  { label: "Respuesta guardada", kinds: [] },
  {
    label: "Cliente en Kan y tarjeta",
    kinds: ["field:ficha_done", "card_details", "panel_client"],
  },
  { label: "Cliente registrado (Sheet)", kinds: ["sheet_row"] },
  { label: "Carpeta preparada", kinds: ["drive_folder"] },
  {
    label: "Compartido",
    kinds: ["drive_share", "field:folder_shared", "field:folder_sent"],
  },
  {
    label: "Segundo correo",
    kinds: ["onboarding_email", ...emailFieldKinds("onboarding")],
  },
  { label: "Ficha estratégica", kinds: [] },
  {
    label: "Brief de marca",
    kinds: ["brief_summary", "brief_doc", "field:brief_done"],
  },
];

const ACCESS_TEXT: Record<string, string> = {
  edicion: "con permiso de edición",
  lectura: "solo lectura por enlace",
  invalida: "dirección no válida para Google",
  no_verificable: "no se pudo verificar",
};

const EMAIL_STATUS: Record<string, string> = {
  sending: "Enviando",
  accepted: "Enviado, sin confirmar entrega",
  delayed: "Entrega demorada",
  delivered: "Entregado",
  opened: "Abierto",
  clicked: "Abierto, con clic en un enlace",
  bounced: "Rebotó",
  complained: "Marcado como spam",
  failed: "No se pudo entregar",
};

type StepState =
  | "done"
  | "running"
  | "waiting"
  | "failed"
  | "uncertain"
  | "none";

const STATE_STYLE: Record<StepState, { dot: string; text: string }> = {
  done: { dot: "bg-green-500", text: "Listo" },
  running: { dot: "bg-blue-500 animate-pulse", text: "En curso" },
  waiting: { dot: "bg-yellow-400", text: "Reintentando" },
  failed: { dot: "bg-red-500", text: "Error" },
  uncertain: { dot: "bg-orange-500", text: "Sin confirmar" },
  none: { dot: "bg-light-400 dark:bg-dark-500", text: "Pendiente" },
};

function stepState(jobs: Job[]): StepState {
  if (!jobs.length) return "none";
  if (jobs.some((j) => j.status === "failed")) return "failed";
  if (jobs.some((j) => j.status === "uncertain")) return "uncertain";
  if (jobs.every((j) => j.status === "done")) return "done";
  if (jobs.some((j) => j.status === "pending" && j.attempts > 0))
    return "waiting";
  return "running";
}

const when = (date: Date | string | null | undefined) =>
  date ? format(new Date(date), "d MMM HH:mm", { locale: es }) : null;

function stepDetail(label: string, client: OnboardingClient, jobs: Job[]) {
  const done = (kind: string) =>
    jobs.find((j) => j.kind === kind && j.status === "done");
  if (label === "Mail de bienvenida" || label === "Segundo correo") {
    const email = client.emails.find(
      (e) =>
        e.kind ===
        (label === "Mail de bienvenida" ? "bienvenida" : "onboarding"),
    );
    if (!email) return null;
    // The time of what matters most: when it was opened, or bounced, or
    // delivered.
    const at = email.bouncedAt ?? email.openedAt ?? email.deliveredAt ?? null;
    return [
      EMAIL_STATUS[email.status] ?? email.status,
      at ? when(at) : null,
      email.toEmail,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (label === "Cliente registrado (Sheet)") {
    const r = done("sheet_row")?.result as
      | { cliCode?: string; rowNumber?: number }
      | undefined;
    return r?.cliCode ? `${r.cliCode} · fila ${r.rowNumber}` : null;
  }
  if (label === "Brief de marca") {
    const r = done("brief_doc")?.result as { url?: string } | undefined;
    return r?.url ? "Documento en la carpeta" : null;
  }
  if (label === "Compartido") {
    const r = done("drive_share")?.result as
      | { access?: string; email?: string }
      | undefined;
    return r?.access
      ? `${r.email} · ${ACCESS_TEXT[r.access] ?? r.access}`
      : null;
  }
  return null;
}

// An email Resend says didn't reach the client shows as an error.
const emailNotReceived = (label: string, client: OnboardingClient) => {
  const kind =
    label === "Mail de bienvenida"
      ? "bienvenida"
      : label === "Segundo correo"
        ? "onboarding"
        : null;
  const email = kind ? client.emails.find((e) => e.kind === kind) : null;
  return ["bounced", "complained", "failed"].includes(email?.status ?? "");
};

const briefUrl = (client: OnboardingClient) => {
  const job = client.jobs.find(
    (j) => j.kind === "brief_doc" && j.status === "done",
  );
  return (job?.result as { url?: string } | null)?.url ?? null;
};

function ClientCard({ client }: { client: OnboardingClient }) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const retry = api.onboarding.retry.useMutation({
    onSuccess: () => utils.onboarding.list.invalidate(),
    onError: (error) =>
      showPopup({
        header: "No se pudo reintentar",
        message: error.message,
        icon: "error",
      }),
  });

  return (
    <div className="rounded-md border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium text-neutral-900 dark:text-dark-1000">
            {client.business ?? client.firstName}
            {client.cliCode && (
              <span className="ml-2 text-xs font-normal text-light-900 dark:text-dark-900">
                {client.cliCode}
              </span>
            )}
            {client.isTest && (
              <span className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                Prueba
              </span>
            )}
          </p>
          <p className="text-xs text-light-900 dark:text-dark-900">
            {client.firstName} · {client.email} · alta {when(client.createdAt)}
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          {client.cardPublicId && (
            <Link className="underline" href={`/cards/${client.cardPublicId}`}>
              Ver tarjeta
            </Link>
          )}
          {client.driveFolderUrl && (
            <a
              className="underline"
              href={client.driveFolderUrl}
              target="_blank"
              rel="noreferrer"
            >
              Carpeta
            </a>
          )}
          <a
            className="underline"
            href={client.adminLink}
            target="_blank"
            rel="noreferrer"
          >
            Ficha inicial
          </a>
          <a
            className="underline"
            href={client.strategicLink}
            target="_blank"
            rel="noreferrer"
          >
            Ficha estratégica
          </a>
          {briefUrl(client) && (
            <a
              className="underline"
              href={briefUrl(client) ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Brief
            </a>
          )}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {STEPS.map((step) => {
          const jobs = client.jobs.filter((j) => step.kinds.includes(j.kind));
          // The two form steps come from the answers, not from jobs.
          const state: StepState =
            step.label === "Respuesta guardada"
              ? client.adminSubmittedAt
                ? "done"
                : "none"
              : step.label === "Ficha estratégica"
                ? client.strategicSubmittedAt
                  ? "done"
                  : client.strategicDraftSavedAt
                    ? "running"
                    : "none"
                : emailNotReceived(step.label, client)
                  ? "failed"
                  : stepState(jobs);
          const detail =
            step.label === "Respuesta guardada"
              ? when(client.adminSubmittedAt)
              : step.label === "Ficha estratégica"
                ? client.strategicSubmittedAt
                  ? `enviada ${when(client.strategicSubmittedAt)}`
                  : client.strategicDraftSavedAt
                    ? `a medias · guardada ${when(client.strategicDraftSavedAt)}`
                    : null
                : stepDetail(step.label, client, jobs);
          const stopped = jobs.filter(
            (j) => j.status === "failed" || j.status === "uncertain",
          );
          const lastDone = jobs
            .map((j) => j.doneAt)
            .filter(Boolean)
            .sort()
            .at(-1);
          const errors = jobs.filter((j) => j.lastError && j.status !== "done");

          return (
            <li key={step.label} className="text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATE_STYLE[state].dot}`}
                />
                <span className="text-neutral-900 dark:text-dark-1000">
                  {step.label}
                </span>
                <span className="text-xs text-light-900 dark:text-dark-900">
                  {STATE_STYLE[state].text}
                  {state === "done" &&
                  lastDone &&
                  step.label !== "Respuesta guardada" &&
                  step.label !== "Ficha estratégica"
                    ? ` · ${when(lastDone)}`
                    : ""}
                  {detail ? ` · ${detail}` : ""}
                </span>
                {stopped.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    disabled={retry.isPending}
                    onClick={() => {
                      if (
                        job.status === "uncertain" &&
                        !window.confirm(
                          "No se sabe si este paso se hizo. Reintentalo solo si revisaste que NO se hizo (por ejemplo, que el correo no está en Resend). ¿Reintentar?",
                        )
                      )
                        return;
                      retry.mutate({ jobId: job.id });
                    }}
                    className="ml-1 flex items-center gap-1 rounded border border-light-300 px-1.5 py-0.5 text-xs hover:bg-light-200 dark:border-dark-400 dark:hover:bg-dark-300"
                  >
                    <HiArrowPath className="h-3 w-3" /> Reintentar
                  </button>
                ))}
              </div>
              {errors.map((job) => (
                <p
                  key={job.id}
                  className="ml-4 mt-0.5 break-words text-xs text-red-600 dark:text-red-400"
                >
                  {job.lastError}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewClientForm({
  onDone,
  liveMode,
}: {
  onDone: () => void;
  liveMode: boolean;
}) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [isTest, setIsTest] = useState(false);
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const create = api.onboarding.create.useMutation({
    onSuccess: async () => {
      await utils.onboarding.list.invalidate();
      onDone();
    },
    onError: (error) =>
      showPopup({
        header: "No se pudo dar de alta",
        message: error.message,
        icon: "error",
      }),
  });

  const input =
    "w-full rounded-md border-0 bg-white/5 px-3 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-700";

  return (
    <form
      className="mb-8 rounded-md border border-light-300 p-4 dark:border-dark-300"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ firstName, email, isTest: liveMode && isTest });
      }}
    >
      <p className="mb-3 text-sm font-medium text-neutral-900 dark:text-dark-1000">
        Nuevo cliente
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-light-900 dark:text-dark-900">
          Nombre de pila
          <input
            className={`mt-1 ${input}`}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label className="text-xs text-light-900 dark:text-dark-900">
          Correo
          <input
            className={`mt-1 ${input}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={320}
          />
        </label>
      </div>
      {liveMode && (
        <label className="mt-3 flex items-center gap-2 text-xs text-light-900 dark:text-dark-900">
          <input
            type="checkbox"
            checked={isTest}
            onChange={(e) => setIsTest(e.target.checked)}
          />
          Es una prueba: los mails te llegan a vos y se usan el Sheet y la
          carpeta de prueba
        </label>
      )}
      <p className="mt-3 text-xs text-light-900 dark:text-dark-900">
        Se crea la tarjeta en Onboarding → Nuevo cliente y se manda el mail de
        bienvenida con el enlace a la ficha.{" "}
        {liveMode && !isTest
          ? "El mail le llega al cliente."
          : "Es una prueba: el mail te llega a vos, no al cliente."}
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" isLoading={create.isPending}>
          Dar de alta
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export default function FormsView() {
  const { workspace } = useWorkspace();
  const [adding, setAdding] = useState(false);
  // Refreshes every few seconds while something is still running.
  const { data, isLoading, error } = api.onboarding.list.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.clients.some((c) =>
        c.jobs.some((j) => j.status === "pending" || j.status === "running"),
      )
        ? 4000
        : 30000,
  });

  return (
    <>
      <PageHead title={`Forms | ${workspace.name ?? "Workspace"}`} />
      <div className="h-full overflow-y-auto">
        <div className="m-auto max-w-[1100px] p-8 px-5 md:px-28 md:py-12">
          <div className="mb-8 flex w-full items-center justify-between">
            <div>
              <h1 className="font-bold tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
                Forms
              </h1>
              {data?.liveMode && (
                <p className="mt-1 text-xs font-medium text-green-700 dark:text-green-400">
                  Modo real: los mails les llegan a los clientes y se usan el
                  Sheet y la carpeta reales.
                </p>
              )}
              {data && !data.liveMode && (
                <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
                  Modo prueba: los mails van solo a tu casilla, con [PRUEBA] en
                  el asunto, y se usa la copia del Sheet y la carpeta PRUEBAS.
                </p>
              )}
            </div>
            {!adding && (
              <Button
                iconLeft={<HiPlus className="h-4 w-4" />}
                onClick={() => setAdding(true)}
              >
                Nuevo cliente
              </Button>
            )}
          </div>

          {adding && (
            <NewClientForm
              liveMode={!!data?.liveMode}
              onDone={() => setAdding(false)}
            />
          )}

          {isLoading && <p className="text-sm text-light-900">Cargando…</p>}
          {error && <p className="text-sm text-red-600">{error.message}</p>}
          {data && !data.clients.length && (
            <p className="text-sm text-light-900 dark:text-dark-900">
              Todavía no hay clientes en alta.
            </p>
          )}
          <div className="space-y-4">
            {data?.clients.map((client) => (
              <ClientCard key={client.publicId} client={client} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
