import Head from "next/head";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";

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

// Impeesa: the administrative form a client opens from the welcome email
// (/f/<token>). No login: the long random token is the key. The questions
// and their texts come from onboarding/adminForm.ts; the server validates
// everything again.

const BLUE = "#2E5469";
const GOLD = "#AB8B4C";

type Answers = Partial<Record<AdminField, string>>;

function Question({
  field,
  required = true,
  error,
  children,
}: {
  field: AdminField;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  const text = ADMIN_TEXT[field];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-[15px] font-medium text-gray-900">
        {text.label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </p>
      {"help" in text && (
        <p className="mt-1 text-sm text-gray-500">{text.help}</p>
      )}
      <div className="mt-3">{children}</div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-[15px] text-gray-900 focus:border-[#2E5469] focus:outline-none focus:ring-1 focus:ring-[#2E5469]";

function Choice({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label
          key={option}
          className="flex cursor-pointer items-center gap-2 text-[15px] text-gray-800"
        >
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
            className="h-4 w-4 accent-[#2E5469]"
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#f4f5f7] px-4 py-8 text-gray-900"
      style={{ colorScheme: "light" }}
    >
      <Head>
        <title>Ficha inicial · Impeesa Marketing</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto max-w-[640px]">
        <div
          className="rounded-t-lg border-t-4 bg-white px-6 py-6"
          style={{ borderColor: GOLD }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/email-logo.png"
            alt="Impeesa Marketing"
            className="h-10 w-auto"
          />
        </div>
        {children}
      </div>
    </div>
  );
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
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Partial<Record<AdminField, string>>>({});

  const set = (field: AdminField) => (value: string) =>
    setAnswers((a) => ({ ...a, [field]: value }));
  const textInput = (field: AdminField, type = "text") => (
    <input
      className={inputClass}
      type={type}
      value={answers[field] ?? ""}
      onChange={(e) => set(field)(e.target.value)}
      maxLength={field === "telefono" ? 50 : 320}
    />
  );

  const fiscal = answers.situacionFiscal;
  const needsCuit =
    fiscal === "Responsable Inscripto" || fiscal === "Monotributista";
  const platform =
    answers.tieneTienda === "SI" ? answers.plataforma : undefined;
  const firstName = useMemo(() => form.data?.firstName, [form.data]);

  if (!token || form.isLoading)
    return (
      <Shell>
        <div className="rounded-b-lg bg-white px-6 pb-8 text-gray-500">
          Cargando…
        </div>
      </Shell>
    );

  if (form.error)
    return (
      <Shell>
        <div className="rounded-b-lg bg-white px-6 pb-8">
          <p className="text-gray-800">
            Este enlace no es válido. Escribinos respondiendo el correo que te
            mandamos.
          </p>
        </div>
      </Shell>
    );

  if (form.data?.submitted || submit.data)
    return (
      <Shell>
        <div className="rounded-b-lg bg-white px-6 pb-8">
          <h1 className="text-xl font-semibold" style={{ color: BLUE }}>
            ¡Gracias{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p className="mt-2 text-gray-700">
            Recibimos tu ficha inicial. En breve te llega un correo con los
            próximos pasos.
          </p>
        </div>
      </Shell>
    );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = adminAnswersSchema.safeParse(answers as AdminAnswersInput);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as AdminField;
        if (!next[field])
          next[field] =
            issue.code === "invalid_type" || issue.code === "invalid_enum_value"
              ? "Obligatoria"
              : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    submit.mutate({ token, answers: answers as AdminAnswersInput });
  };

  return (
    <Shell>
      <div className="rounded-b-lg bg-white px-6 pb-6">
        <h1 className="text-2xl font-semibold" style={{ color: BLUE }}>
          Ficha inicial
        </h1>
        <p className="mt-2 text-gray-600">
          {firstName ? `Hola ${firstName}, ` : ""}completá estos datos para que
          podamos empezar a trabajar.
        </p>
        <p className="mt-2 text-sm text-red-600">* Obligatoria</p>
      </div>

      <form className="mt-4 space-y-3" onSubmit={onSubmit} noValidate>
        <Question field="razonSocial" error={errors.razonSocial}>
          {textInput("razonSocial")}
        </Question>
        <Question field="nombreFantasia" error={errors.nombreFantasia}>
          {textInput("nombreFantasia")}
        </Question>
        <Question field="servicio" error={errors.servicio}>
          <Choice
            name="servicio"
            options={SERVICES}
            value={answers.servicio}
            onChange={set("servicio")}
          />
        </Question>
        <Question field="nombreContacto" error={errors.nombreContacto}>
          {textInput("nombreContacto")}
        </Question>
        <Question field="telefono" error={errors.telefono}>
          {textInput("telefono", "tel")}
        </Question>
        <Question field="correoContacto" error={errors.correoContacto}>
          {textInput("correoContacto", "email")}
        </Question>
        <Question field="facturaMismoCorreo" error={errors.facturaMismoCorreo}>
          <Choice
            name="facturaMismoCorreo"
            options={YES_NO}
            value={answers.facturaMismoCorreo}
            onChange={set("facturaMismoCorreo")}
          />
        </Question>
        {answers.facturaMismoCorreo === "NO" && (
          <Question field="correoFactura" error={errors.correoFactura}>
            {textInput("correoFactura", "email")}
          </Question>
        )}
        <Question field="situacionFiscal" error={errors.situacionFiscal}>
          <select
            className={inputClass}
            value={answers.situacionFiscal ?? ""}
            onChange={(e) => set("situacionFiscal")(e.target.value)}
          >
            <option value="" disabled>
              Seleccioná una opción
            </option>
            {TAX_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Question>
        {needsCuit && (
          <Question field="cuit" error={errors.cuit}>
            <input
              className={inputClass}
              inputMode="numeric"
              value={answers.cuit ?? ""}
              onChange={(e) => set("cuit")(e.target.value)}
              maxLength={20}
            />
          </Question>
        )}
        {fiscal === "Consumidor final (no inscripto en ARCA)" && (
          <Question field="dni" error={errors.dni}>
            {textInput("dni")}
          </Question>
        )}
        {fiscal === "Residente fuera de Argentina" && (
          <Question field="idFiscalExterior" error={errors.idFiscalExterior}>
            {textInput("idFiscalExterior")}
          </Question>
        )}
        <Question field="instagram" required={false} error={errors.instagram}>
          {textInput("instagram")}
        </Question>
        <Question field="tieneTienda" error={errors.tieneTienda}>
          <Choice
            name="tieneTienda"
            options={STORE_YES_NO}
            value={answers.tieneTienda}
            onChange={set("tieneTienda")}
          />
        </Question>
        {answers.tieneTienda === "SI" && (
          <Question field="plataforma" error={errors.plataforma}>
            <select
              className={inputClass}
              value={answers.plataforma ?? ""}
              onChange={(e) => set("plataforma")(e.target.value)}
            >
              <option value="" disabled>
                Seleccioná una opción
              </option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Question>
        )}
        {platform === "Tienda nube" && (
          <Question field="correoTiendanube" error={errors.correoTiendanube}>
            {textInput("correoTiendanube", "email")}
          </Question>
        )}
        {platform && platform !== "Tienda nube" && platform !== "Otras" && (
          <Question field="correoTienda" error={errors.correoTienda}>
            {textInput("correoTienda", "email")}
          </Question>
        )}

        {Object.keys(errors).length > 0 && (
          <p className="text-sm text-red-600">
            Revisá las preguntas marcadas en rojo.
          </p>
        )}
        {submit.error && (
          <p className="text-sm text-red-600">
            No se pudo enviar. Probá de nuevo en un momento.
          </p>
        )}
        <div className="pb-10">
          <button
            type="submit"
            disabled={submit.isPending}
            className="rounded-md px-6 py-2.5 text-[15px] font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: BLUE }}
          >
            {submit.isPending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </Shell>
  );
}
