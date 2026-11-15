import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AdminAnswersInput,
  AdminField,
} from "@kan/api/onboarding/adminForm";
import {
  ADMIN_TEXT,
  adminAnswersSchema,
  PLATFORMS,
  SERVICES,
  STORE_YES_NO,
  TAX_STATUSES,
  YES_NO,
} from "@kan/api/onboarding/adminForm";

import { api } from "~/utils/api";
import {
  Shell as BaseShell,
  C,
  Card,
  GhostButton,
  GoldButton,
} from "~/views/forms/chrome";

// Impeesa: the administrative form a client opens from the welcome email
// (/f/<token>). One question per card, with the look of impeesamarketing.com
// (dark background, gold accents). No login: the long random token is the
// key. Questions and texts come from onboarding/adminForm.ts; the server
// validates everything again.

const Shell = ({ children }: { children: React.ReactNode }) => (
  <BaseShell title="Ficha inicial" label="Ficha inicial">
    {children}
  </BaseShell>
);

type Answers = Partial<Record<AdminField, string>>;

interface Step {
  field: AdminField;
  kind: "text" | "email" | "tel" | "number" | "choice";
  options?: readonly string[];
  optional?: boolean;
}

// Questions shown, in order, given what was answered so far.
function visibleSteps(a: Answers): Step[] {
  const steps: Step[] = [
    { field: "razonSocial", kind: "text" },
    { field: "nombreFantasia", kind: "text" },
    { field: "servicio", kind: "choice", options: SERVICES },
    { field: "nombreContacto", kind: "text" },
    { field: "telefono", kind: "tel" },
    { field: "correoContacto", kind: "email" },
    { field: "facturaMismoCorreo", kind: "choice", options: YES_NO },
  ];
  if (a.facturaMismoCorreo === "NO")
    steps.push({ field: "correoFactura", kind: "email" });
  steps.push({
    field: "situacionFiscal",
    kind: "choice",
    options: TAX_STATUSES,
  });
  if (
    a.situacionFiscal === "Responsable Inscripto" ||
    a.situacionFiscal === "Monotributista"
  )
    steps.push({ field: "cuit", kind: "number" });
  if (a.situacionFiscal === "Consumidor final (no inscripto en ARCA)")
    steps.push({ field: "dni", kind: "text" });
  if (a.situacionFiscal === "Residente fuera de Argentina")
    steps.push({ field: "idFiscalExterior", kind: "text" });
  steps.push({ field: "instagram", kind: "text", optional: true });
  steps.push({ field: "tieneTienda", kind: "choice", options: STORE_YES_NO });
  if (a.tieneTienda === "SI") {
    steps.push({ field: "plataforma", kind: "choice", options: PLATFORMS });
    if (a.plataforma === "Tienda nube")
      steps.push({ field: "correoTiendanube", kind: "email" });
    else if (a.plataforma && a.plataforma !== "Otras")
      steps.push({ field: "correoTienda", kind: "email" });
  }
  return steps;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The same rules as the server, checked as soon as the client moves on.
function stepError(step: Step, value = ""): string | null {
  const v = value.trim();
  if (!v) return step.optional ? null : "Esta respuesta es obligatoria";
  if (step.kind === "email" && !EMAIL.test(v)) return "Revisá el correo";
  if (step.field === "cuit" && !/^\d{11}$/.test(v))
    return "Tienen que ser los 11 números, sin guiones ni puntos";
  if (step.field === "telefono" && v.replace(/\D/g, "").length < 6)
    return "Revisá el teléfono";
  return null;
}

export default function AdminFormPage() {
  const router = useRouter();
  const token =
    typeof router.query.token === "string" ? router.query.token : "";
  const form = api.onboarding.publicForm.useQuery(
    { token },
    { enabled: !!token, retry: false, refetchOnWindowFocus: false },
  );
  const submit = api.onboarding.submitAdministrativa.useMutation();

  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"in" | "back">("in");
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const steps = useMemo(() => visibleSteps(answers), [answers]);
  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;
  const firstName = form.data?.firstName;

  useEffect(() => {
    if (started && step && step.kind !== "choice")
      setTimeout(() => inputRef.current?.focus(), 60);
  }, [started, index, step]);

  const goTo = (target: number) => {
    setDirection(target < index ? "back" : "in");
    setError(null);
    setIndex(target);
  };

  const send = (final: Answers) => {
    const parsed = adminAnswersSchema.safeParse(final as AdminAnswersInput);
    if (!parsed.success) {
      // Shouldn't happen (every card was checked); go to the first problem.
      const field = parsed.error.issues[0]?.path[0] as AdminField | undefined;
      const at = visibleSteps(final).findIndex((s) => s.field === field);
      if (at >= 0) goTo(at);
      setError("Revisá esta respuesta");
      return;
    }
    submit.mutate({ token, answers: final as AdminAnswersInput });
  };

  const next = (current: Answers = answers) => {
    if (!step) return;
    const problem = stepError(step, current[step.field]);
    if (problem) {
      setError(problem);
      return;
    }
    // Recomputed: an answer may add or remove the following questions.
    const nextSteps = visibleSteps(current);
    const position = nextSteps.findIndex((s) => s.field === step.field);
    if (position >= nextSteps.length - 1) send(current);
    else goTo(position + 1);
  };

  const choose = (value: string) => {
    if (!step) return;
    const updated = { ...answers, [step.field]: value };
    setAnswers(updated);
    setError(null);
    // A choice moves on by itself, after a short beat to see it marked. The
    // last question waits for "Enviar ficha" instead of sending on its own.
    const nextSteps = visibleSteps(updated);
    if (
      nextSteps.findIndex((s) => s.field === step.field) <
      nextSteps.length - 1
    )
      setTimeout(() => next(updated), 220);
  };

  if (!token || form.isLoading)
    return (
      <Shell>
        <p className="text-center text-sm" style={{ color: C.dim }}>
          Cargando…
        </p>
      </Shell>
    );

  if (form.error)
    return (
      <Shell>
        <Card>
          <h1 className="text-2xl font-bold tracking-tight">
            Este enlace no es válido
          </h1>
          <p
            className="mt-3 text-[15px] leading-relaxed"
            style={{ color: C.muted }}
          >
            Escribinos respondiendo el correo que te mandamos y te pasamos uno
            nuevo.
          </p>
        </Card>
      </Shell>
    );

  if (form.data?.submitted || submit.data)
    return (
      <Shell>
        <Card key="done">
          <div
            className="mb-6 grid h-12 w-12 place-items-center rounded-full border text-xl"
            style={{
              borderColor: `${C.gold2}80`,
              color: C.gold2,
              background: "rgba(171,139,72,.1)",
            }}
          >
            ✓
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            ¡Gracias{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p
            className="mt-3 text-[16px] leading-relaxed"
            style={{ color: C.muted }}
          >
            Recibimos tu ficha inicial. En breve te llega un correo con los
            próximos pasos.
          </p>
        </Card>
      </Shell>
    );

  if (!started)
    return (
      <Shell>
        <Card key="intro">
          <span
            className="font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: C.gold2 }}
          >
            Ficha inicial
          </span>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {firstName ? `Hola ${firstName}, ` : ""}empecemos.
          </h1>
          <p
            className="mt-4 text-[16px] leading-relaxed"
            style={{ color: C.muted }}
          >
            Son unas {steps.length} preguntas cortas, una por vez, con los datos
            que necesitamos para empezar a trabajar: facturación, contacto y tu
            tienda. Te lleva unos 3 minutos.
          </p>
          <div className="mt-8">
            <GoldButton type="button" onClick={() => setStarted(true)}>
              Empezar →
            </GoldButton>
          </div>
        </Card>
      </Shell>
    );

  if (!step) return null;
  const text = ADMIN_TEXT[step.field];
  const value = answers[step.field] ?? "";

  return (
    <Shell>
      <div className="mb-5 flex gap-1.5" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s.field}
            className="h-1 flex-1 rounded-full transition-colors duration-300"
            style={{
              background: i <= index ? C.gold2 : "rgba(255,255,255,.08)",
            }}
          />
        ))}
      </div>

      <Card key={step.field} direction={direction}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          noValidate
        >
          <span className="font-mono text-[13px]" style={{ color: C.dim }}>
            {index + 1} / {steps.length}
            {step.optional ? " · opcional" : ""}
          </span>
          <h2 className="mt-2 text-2xl font-bold leading-snug tracking-tight sm:text-[28px]">
            {text.label}
          </h2>
          {"help" in text && (
            <p
              className="mt-2 text-[15px] leading-relaxed"
              style={{ color: C.muted }}
            >
              {text.help}
            </p>
          )}

          <div className="mt-6">
            {step.kind === "choice" ? (
              <div
                className={`grid gap-2.5 ${step.options && step.options.length > 3 ? "sm:grid-cols-2" : ""}`}
              >
                {step.options?.map((option) => {
                  const pressed = value === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => choose(option)}
                      className="flex items-center gap-3 rounded-[14px] border px-4 py-3.5 text-left text-[15px] transition-colors hover:!border-white/30"
                      style={{
                        borderColor: pressed ? `${C.gold2}99` : C.line,
                        background: pressed
                          ? "rgba(171,139,72,.1)"
                          : "rgba(255,255,255,.02)",
                        color: C.fg,
                      }}
                    >
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border"
                        style={{ borderColor: pressed ? C.gold2 : C.line2 }}
                      >
                        {pressed && (
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: C.gold2 }}
                          />
                        )}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                ref={inputRef}
                className="imp-input h-14 w-full rounded-xl border bg-black/25 px-4 text-[17px] outline-none transition-colors focus:!border-[#d1be93]"
                style={{
                  borderColor: error ? "#f87171" : C.line2,
                  color: C.fg,
                }}
                type={
                  step.kind === "email"
                    ? "email"
                    : step.kind === "tel"
                      ? "tel"
                      : "text"
                }
                inputMode={step.kind === "number" ? "numeric" : undefined}
                autoComplete={
                  step.field === "correoContacto"
                    ? "email"
                    : step.field === "telefono"
                      ? "tel"
                      : step.field === "nombreContacto"
                        ? "name"
                        : "off"
                }
                maxLength={step.field === "telefono" ? 50 : 320}
                value={value}
                placeholder={
                  step.optional ? "Podés dejarlo vacío" : "Escribí tu respuesta"
                }
                onChange={(e) => {
                  setAnswers((a) => ({ ...a, [step.field]: e.target.value }));
                  if (error) setError(null);
                }}
              />
            )}
            {error && (
              <p className="mt-3 text-sm" style={{ color: "#f87171" }}>
                {error}
              </p>
            )}
            {submit.error && (
              <p className="mt-3 text-sm" style={{ color: "#f87171" }}>
                No se pudo enviar. Probá de nuevo en un momento.
              </p>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-2.5">
            <GhostButton
              type="button"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              ← Atrás
            </GhostButton>
            {(step.kind !== "choice" || value) && (
              <GoldButton type="submit" disabled={submit.isPending}>
                {submit.isPending
                  ? "Enviando…"
                  : isLast
                    ? "Enviar ficha"
                    : "Siguiente →"}
              </GoldButton>
            )}
          </div>
          {step.kind !== "choice" && (
            <p
              className="mt-4 hidden text-xs sm:block"
              style={{ color: C.dim }}
            >
              Apretá Enter ↵ para seguir
            </p>
          )}
        </form>
      </Card>
    </Shell>
  );
}
