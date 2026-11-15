import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  StrategicAnswersDraft,
  StrategicAnswersInput,
  StrategicField,
  StrategicQuestion,
  StrategicSection,
} from "@kan/api/onboarding/strategicForm";
import {
  STRATEGIC_SECTIONS,
  STRATEGIC_TEXT,
  strategicAnswersSchema,
  strategicQuestions,
} from "@kan/api/onboarding/strategicForm";

import { api } from "~/utils/api";
import {
  Shell as BaseShell,
  C,
  Card,
  GhostButton,
  GoldButton,
} from "~/views/forms/chrome";

// Impeesa: the strategic form ("Ficha de cliente") a client opens from the
// second email (/f/<token>/estrategica). Same look as the first form, one
// question per card. It is long, so every answer is saved in the panel as
// the client goes: they can stop and come back with the same link, even
// from another device. Sending it is a single, final step; only then is the
// brief made.

const Shell = ({ children }: { children: React.ReactNode }) => (
  <BaseShell title="Ficha de cliente" label="Ficha de cliente">
    {children}
  </BaseShell>
);

type Step =
  | { id: string; type: "section"; section: StrategicSection }
  | { id: string; type: "question"; question: StrategicQuestion };

// The questions shown given the answers, with a card that opens each
// section.
function buildSteps(a: StrategicAnswersDraft): Step[] {
  const steps: Step[] = [];
  let section: StrategicSection | null = null;
  for (const question of strategicQuestions(a)) {
    if (question.section !== section) {
      section = question.section;
      steps.push({ id: `section:${section}`, type: "section", section });
    }
    steps.push({ id: question.field, type: "question", question });
  }
  return steps;
}

function questionError(q: StrategicQuestion, value: unknown): string | null {
  if (q.kind === "multi") {
    const list = Array.isArray(value) ? value : [];
    if (!list.length) return "Elegí al menos una opción";
    if (q.max && list.length > q.max) return `Elegí hasta ${q.max}`;
    return null;
  }
  return typeof value === "string" && value.trim()
    ? null
    : "Esta respuesta es obligatoria";
}

const timeOf = (date: Date) =>
  date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

export default function StrategicFormPage() {
  const router = useRouter();
  const token =
    typeof router.query.token === "string" ? router.query.token : "";
  const form = api.onboarding.publicStrategic.useQuery(
    { token },
    { enabled: !!token, retry: false, refetchOnWindowFocus: false },
  );
  const save = api.onboarding.saveStrategicDraft.useMutation();
  const submit = api.onboarding.submitEstrategica.useMutation();

  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"in" | "back">("in");
  const [answers, setAnswers] = useState<StrategicAnswersDraft>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const dirty = useRef(false);
  const latest = useRef({ answers, index });
  latest.current = { answers, index };

  const steps = useMemo(() => buildSteps(answers), [answers]);
  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;
  const questionCount = steps.filter((s) => s.type === "question").length;
  const questionNumber = steps
    .slice(0, index + 1)
    .filter((s) => s.type === "question").length;

  // What was saved before comes back; the business name starts as the one
  // given in the first form.
  useEffect(() => {
    if (!form.data || loaded) return;
    const draft = form.data.draft;
    const initial: StrategicAnswersDraft = { ...(draft?.answers ?? {}) };
    if (initial.nombreFantasia === undefined && form.data.business)
      initial.nombreFantasia = form.data.business;
    setAnswers(initial);
    if (draft) {
      setIndex(Math.min(draft.step, buildSteps(initial).length - 1));
      setSavedAt(new Date(draft.savedAt));
    }
    setLoaded(true);
  }, [form.data, loaded]);

  const persist = useCallback(
    async (override?: { answers?: StrategicAnswersDraft; index?: number }) => {
      if (!token) return true;
      const payload = { ...latest.current, ...override };
      dirty.current = false;
      try {
        const result = await save.mutateAsync({
          token,
          answers: payload.answers as Record<string, string | string[]>,
          step: payload.index,
        });
        if (result.savedAt) setSavedAt(new Date(result.savedAt));
        setSaveFailed(false);
        return true;
      } catch {
        dirty.current = true;
        setSaveFailed(true);
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  // While typing, saved a moment after the client stops.
  useEffect(() => {
    if (!started || !dirty.current) return;
    const timer = setTimeout(() => void persist(), 1500);
    return () => clearTimeout(timer);
  }, [answers, started, persist]);

  // Leaving the page with something unsaved: one last try.
  useEffect(() => {
    const flush = () => {
      if (dirty.current) void persist();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [persist]);

  useEffect(() => {
    if (
      started &&
      step?.type === "question" &&
      ["short", "long"].includes(step.question.kind)
    )
      setTimeout(() => inputRef.current?.focus(), 60);
  }, [started, index, step]);

  const goTo = (target: number, current = answers) => {
    setDirection(target < index ? "back" : "in");
    setError(null);
    setIndex(target);
    void persist({ answers: current, index: target });
  };

  const update = (field: StrategicField, value: string | string[]) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [field]: value }));
    if (error) setError(null);
  };

  const send = (final: StrategicAnswersDraft) => {
    const parsed = strategicAnswersSchema.safeParse(final);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      const at = buildSteps(final).findIndex((s) => s.id === field);
      if (at >= 0) goTo(at, final);
      setError("Revisá esta respuesta");
      return;
    }
    submit.mutate({ token, answers: final as StrategicAnswersInput });
  };

  const next = (current: StrategicAnswersDraft = answers) => {
    if (!step) return;
    if (step.type === "question") {
      const problem = questionError(
        step.question,
        current[step.question.field],
      );
      if (problem) {
        setError(problem);
        return;
      }
    }
    // Recomputed: a "SI"/"No" adds or removes the "Descríbelo" after it.
    const nextSteps = buildSteps(current);
    const position = nextSteps.findIndex((s) => s.id === step.id);
    if (position >= nextSteps.length - 1) send(current);
    else goTo(position + 1, current);
  };

  const choose = (field: StrategicField, value: string) => {
    const updated = { ...answers, [field]: value };
    setAnswers(updated);
    setError(null);
    const nextSteps = buildSteps(updated);
    if (nextSteps.findIndex((s) => s.id === field) < nextSteps.length - 1)
      setTimeout(() => next(updated), 220);
    else void persist({ answers: updated });
  };

  const toggle = (q: StrategicQuestion, option: string) => {
    const current = Array.isArray(answers[q.field])
      ? (answers[q.field] as string[])
      : [];
    const has = current.includes(option);
    if (!has && q.max && current.length >= q.max) {
      setError(`Elegí hasta ${q.max}`);
      return;
    }
    update(
      q.field,
      has ? current.filter((o) => o !== option) : [...current, option],
    );
  };

  const pause = async () => {
    const ok = await persist();
    if (ok) setPaused(true);
  };

  const saveStatus = save.isPending
    ? "Guardando…"
    : saveFailed
      ? "No se pudo guardar; reintentamos al seguir"
      : savedAt
        ? `Guardado ${timeOf(savedAt)}`
        : null;

  if (!token || form.isLoading || (form.data && !loaded))
    return (
      <Shell>
        <p className="text-center text-sm" style={{ color: C.dim }}>
          Cargando…
        </p>
      </Shell>
    );

  if (form.error || !form.data)
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

  const firstName = form.data.firstName;

  if (form.data.submitted || submit.data)
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
            Recibimos tu ficha de cliente. Con esto empezamos a armar la
            estrategia de tu marca.
          </p>
        </Card>
      </Shell>
    );

  if (!form.data.adminDone)
    return (
      <Shell>
        <Card>
          <h1 className="text-2xl font-bold tracking-tight">
            Primero completá la ficha inicial
          </h1>
          <p
            className="mt-3 text-[15px] leading-relaxed"
            style={{ color: C.muted }}
          >
            Está en el primer correo que te mandamos. Cuando la envíes, volvé a
            este enlace.
          </p>
        </Card>
      </Shell>
    );

  if (paused)
    return (
      <Shell>
        <Card key="paused">
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
          <h1 className="text-3xl font-bold tracking-tight">Quedó guardado</h1>
          <p
            className="mt-3 text-[16px] leading-relaxed"
            style={{ color: C.muted }}
          >
            Podés seguir cuando quieras con el mismo enlace del correo, desde
            este o cualquier otro dispositivo. Vas a volver a la pregunta donde
            quedaste.
          </p>
          <div className="mt-8">
            <GoldButton
              type="button"
              onClick={() => {
                setPaused(false);
                setStarted(true);
              }}
            >
              Seguir ahora →
            </GoldButton>
          </div>
        </Card>
      </Shell>
    );

  const hasDraft = !!form.data.draft;

  if (!started)
    return (
      <Shell>
        <Card key="intro">
          <span
            className="font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: C.gold2 }}
          >
            Bienvenido a Impeesa Marketing
          </span>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {hasDraft
              ? `${firstName ? `Hola de nuevo, ${firstName}. ` : ""}Seguimos donde quedaste.`
              : `${firstName ? `Hola ${firstName}, ` : ""}empecemos.`}
          </h1>
          <p
            className="mt-4 text-[16px] leading-relaxed"
            style={{ color: C.muted }}
          >
            Por favor, proporcione la siguiente información sobre su negocio
            para ayudarnos a entender mejor sus necesidades.
          </p>
          <p
            className="mt-3 text-[15px] leading-relaxed"
            style={{ color: C.dim }}
          >
            Son {questionCount} preguntas, una por vez. Lo que respondés se
            guarda solo: podés dejarla y seguir otro día con este mismo enlace.
          </p>
          <div className="mt-8">
            <GoldButton type="button" onClick={() => setStarted(true)}>
              {hasDraft ? "Seguir →" : "Empezar →"}
            </GoldButton>
          </div>
        </Card>
      </Shell>
    );

  if (!step) return null;

  const footer = (
    <div
      className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs"
      style={{ color: C.dim }}
    >
      <span aria-live="polite">{saveStatus}</span>
      <button
        type="button"
        onClick={() => void pause()}
        disabled={save.isPending}
        className="underline decoration-white/20 underline-offset-4 transition-colors hover:text-white disabled:opacity-50"
      >
        Guardar y seguir después
      </button>
    </div>
  );

  const progress = (
    <div className="mb-5 flex gap-1" aria-hidden>
      {steps.map((s, i) => (
        <span
          key={s.id}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{
            background: i <= index ? C.gold2 : "rgba(255,255,255,.08)",
          }}
        />
      ))}
    </div>
  );

  if (step.type === "section") {
    const section = STRATEGIC_SECTIONS[step.section];
    return (
      <Shell>
        {progress}
        <Card key={step.id} direction={direction}>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: C.gold2 }}
          >
            Sección
          </span>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
            {section.title}
          </h2>
          {"help" in section && (
            <p
              className="mt-4 whitespace-pre-line text-[15px] leading-relaxed"
              style={{ color: C.muted }}
            >
              {section.help}
            </p>
          )}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-2.5">
            <GhostButton
              type="button"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              ← Atrás
            </GhostButton>
            <GoldButton type="button" onClick={() => next()}>
              Siguiente →
            </GoldButton>
          </div>
        </Card>
        {footer}
      </Shell>
    );
  }

  const q = step.question;
  const text = STRATEGIC_TEXT[q.field];
  const value = answers[q.field];
  const stringValue = typeof value === "string" ? value : "";
  const listValue = Array.isArray(value) ? value : [];

  return (
    <Shell>
      {progress}
      <Card key={step.id} direction={direction}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          noValidate
        >
          <span className="font-mono text-[13px]" style={{ color: C.dim }}>
            {questionNumber} / {questionCount} ·{" "}
            {STRATEGIC_SECTIONS[q.section].title}
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
          {q.kind === "multi" && (
            <p className="mt-2 text-[13px]" style={{ color: C.dim }}>
              {q.max
                ? `Podés elegir hasta ${q.max}.`
                : "Podés elegir más de una."}
            </p>
          )}

          <div className="mt-6">
            {q.kind === "choice" || q.kind === "multi" ? (
              <div
                className={`grid gap-2.5 ${q.options && q.options.length > 3 ? "sm:grid-cols-2" : ""}`}
              >
                {q.options?.map((option) => {
                  const pressed =
                    q.kind === "multi"
                      ? listValue.includes(option)
                      : stringValue === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() =>
                        q.kind === "multi"
                          ? toggle(q, option)
                          : choose(q.field, option)
                      }
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
                        className={`grid h-5 w-5 shrink-0 place-items-center border ${q.kind === "multi" ? "rounded-md" : "rounded-full"}`}
                        style={{ borderColor: pressed ? C.gold2 : C.line2 }}
                      >
                        {pressed &&
                          (q.kind === "multi" ? (
                            <span
                              className="text-[12px] font-bold leading-none"
                              style={{ color: C.gold2 }}
                            >
                              ✓
                            </span>
                          ) : (
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: C.gold2 }}
                            />
                          ))}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : q.kind === "long" ? (
              <textarea
                ref={inputRef}
                rows={6}
                maxLength={10000}
                className="imp-input w-full resize-y rounded-xl border bg-black/25 px-4 py-3 text-[16px] leading-relaxed outline-none transition-colors focus:!border-[#d1be93]"
                style={{
                  borderColor: error ? "#f87171" : C.line2,
                  color: C.fg,
                }}
                value={stringValue}
                placeholder="Escribí tu respuesta"
                onChange={(e) => update(q.field, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    next();
                  }
                }}
              />
            ) : (
              <input
                ref={inputRef}
                className="imp-input h-14 w-full rounded-xl border bg-black/25 px-4 text-[17px] outline-none transition-colors focus:!border-[#d1be93]"
                style={{
                  borderColor: error ? "#f87171" : C.line2,
                  color: C.fg,
                }}
                type="text"
                autoComplete="off"
                maxLength={2000}
                value={stringValue}
                placeholder="Escribí tu respuesta"
                onChange={(e) => update(q.field, e.target.value)}
              />
            )}
            {error && (
              <p className="mt-3 text-sm" style={{ color: "#f87171" }}>
                {error}
              </p>
            )}
            {submit.error && (
              <p className="mt-3 text-sm" style={{ color: "#f87171" }}>
                No se pudo enviar. Tus respuestas están guardadas; probá de
                nuevo en un momento.
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
            {(q.kind !== "choice" || stringValue) && (
              <GoldButton type="submit" disabled={submit.isPending}>
                {submit.isPending
                  ? "Enviando…"
                  : isLast
                    ? "Enviar ficha"
                    : "Siguiente →"}
              </GoldButton>
            )}
          </div>
          {(q.kind === "short" || q.kind === "long") && (
            <p
              className="mt-4 hidden text-xs sm:block"
              style={{ color: C.dim }}
            >
              {q.kind === "long"
                ? "Ctrl + Enter ↵ para seguir"
                : "Apretá Enter ↵ para seguir"}
            </p>
          )}
        </form>
      </Card>
      {footer}
    </Shell>
  );
}
