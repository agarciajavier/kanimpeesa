import { z } from "zod";

// Impeesa onboarding: the strategic form ("Ficha de cliente", Microsoft
// Forms UEubFsb6J1), copied word for word on 14/11, typos included: the
// texts are Impeesa's and are not corrected without authorization.
//
// It is long, so the client can save it and come back later with the same
// link (see onboarding_draft). Pure data and validation: used by the public
// page and by the server, which validates again.

export const STRATEGIC_FORM_VERSION = 1;

export const LAUNCHES = ["SI", "Esporádicamente", "NO"] as const;
export const AGES = [
  "de 18 a 24 años",
  "de 25 a 34 años",
  "de 35 a 44 años",
  "de 45 a 54 años",
  "de 55 a 65 años",
  "más de 65 años",
] as const;
export const SEXES = [
  "50% hombres - 50% mujeres",
  "70% mujeres - 30% hombres",
  "70% hombres - 30% mujeres",
  "Solo mujeres",
  "Solo hombres",
] as const;
export const INCOME = [
  "Bajo",
  "Medio bajo",
  "Medio",
  "medio alto",
  "alto",
] as const;
// "Poder adquisitivo" allows up to three options.
export const INCOME_MAX = 3;
export const STUDIES = [
  "Ninguno",
  "Primario",
  "Secundario",
  "Universitario",
  "Post - grado",
] as const;
export const SI_NO = ["SI", "No"] as const;

export const STRATEGIC_SECTIONS = {
  negocio: { title: "Sobre tu negocio" },
  cliente: {
    title: "Sobre tu cliente ideal",
    help: "El siguiente cuestionario es para identificar el cliente ideal. Si crees que hay más de un perfil de cliente ideal, completa la información con el más significativo. Al final del cuestionario, vas a poder redactar el resto de los perfiles.IMPORTANTE: Es un ejercicio a realizar en cuanto a tu experiencia diaria con los clientes, hay información que no es que hay que SABERLA o NO SABERLA, sino que hay que SUPONERLA para establecer un punto de partida. Completar todos los campos nos facilita entender a quien le hablamos.",
  },
  diseno: { title: "Sobre el diseño" },
} as const;

export type StrategicSection = keyof typeof STRATEGIC_SECTIONS;

export const STRATEGIC_TEXT = {
  nombreFantasia: {
    label: "Nombre de Fantasía del negocio",
    help: "Recuerda poner el mismo que usaste en el formulario administrativo",
  },
  historia: {
    label: "Historia de la marca",
    help: "Cuentanos un poco sobre el origen de la marca y la situación actual de la misma, cualquier historia que esté realcionada con ella nos resulta útil",
  },
  palabrasClave: {
    label: "Palabras claves con las que tus clientes pueden buscarte",
    help: "Incluye todas las creas relevante",
  },
  competidores: {
    label: "Principales competidores",
    help: "Pueden ser competencia directa (el mismo producto y en el mismo idioma) o indirecta (productos derivados o en diferente idioma o país)",
  },
  zona: { label: "Zona geográfica a segmentar" },
  resaltar: {
    label: "¿Qué te gustaría que resalte en tus anuncios?",
    help: "Pueden ser palabras o frases relacionadas con tu producto o servicio o con la personalidad de la marca.DESAFÍO EXTRA: Intenta evitar utilizar la frase precio/calidad",
  },
  lanzamientos: { label: "¿Suelen hacer lanzamientos de nuevos productos?" },
  debilidades: {
    label: "¿Cuales son las principales debilidades de tu producto / servicio?",
  },
  fortalezas: {
    label: "¿Cuáles son las principales fortalezas de tu producto / servicio?",
  },
  espiritu: {
    label:
      "¿Cuál es el espíritu que querés exhibir en el general de los anuncios?",
  },
  sentimientos: {
    label:
      "¿Qué sentimientos y asociaciones querés que estén relacionados con tu marca?",
  },
  personalidad: {
    label:
      "¿Si tu marca tuviera una personalidad, cuál sería? (describilo como si fuera una persona)",
  },
  slogan: { label: "¿Tienen un slogan que quieran utilizar?" },
  quienesSomos: {
    label:
      'Redactá el mejor "quienes somos" que te describa como empresa y emprendedor.',
  },
  presupuesto: {
    label: "Presupuesto mensual disponible para publicidad",
    help: "Ingresa tu presupuesto disponible SIN IMPUESTOS",
  },
  edad: { label: "Edad" },
  sexo: { label: "Sexo" },
  poderAdquisitivo: { label: "Poder adquisitivo" },
  estudios: { label: "Nivel de estudios" },
  gustos: { label: "Gustos o aficiones" },
  miedos: { label: "Miedos o preocupaciones" },
  suenos: { label: "Sueños o aspiraciones" },
  clienteNoIdeal: {
    label: "Tenés algún tipo de cliente NO IDEAL",
    help: "Por cliente NO IDEAL, nos referimos a algún tipo de cliente con el que no quieras trabajar o no le resultaría de utilidad tu producto o servicio",
  },
  noIdealDescripcion: { label: "Descríbelo" },
  otroPerfil: {
    label: "Otro perfil de cliente ideal",
    help: "Indica si tienes otro perfil de cliente ideal relevante para describir",
  },
  otroPerfilDescripcion: { label: "Descríbelo" },
  colores: {
    label: "Código de colores y paletas que utiliza la marca",
    help: "Agrega los códigos hex de los principales colores que usa la marca",
  },
  tipografias: {
    label: "Tipografías",
    help: "Tipografías usada por la marca si tenes los archivos subilo a la carpeta Marca de Drive",
  },
  estilo: {
    label: "¿Qué estilo querés mostrar en tus anuncios?",
    help: "Formal, juvenil, consolidado, serio, novedoso, disruptivo, tranquilo, ameno (detalla)",
  },
} as const;

export type StrategicField = keyof typeof STRATEGIC_TEXT;

export interface StrategicQuestion {
  field: StrategicField;
  section: StrategicSection;
  kind: "short" | "long" | "choice" | "multi";
  options?: readonly string[];
  max?: number;
}

const ALL_QUESTIONS: StrategicQuestion[] = [
  { field: "nombreFantasia", section: "negocio", kind: "short" },
  { field: "historia", section: "negocio", kind: "long" },
  { field: "palabrasClave", section: "negocio", kind: "short" },
  { field: "competidores", section: "negocio", kind: "long" },
  { field: "zona", section: "negocio", kind: "short" },
  { field: "resaltar", section: "negocio", kind: "short" },
  {
    field: "lanzamientos",
    section: "negocio",
    kind: "choice",
    options: LAUNCHES,
  },
  { field: "debilidades", section: "negocio", kind: "long" },
  { field: "fortalezas", section: "negocio", kind: "long" },
  { field: "espiritu", section: "negocio", kind: "long" },
  { field: "sentimientos", section: "negocio", kind: "long" },
  { field: "personalidad", section: "negocio", kind: "long" },
  { field: "slogan", section: "negocio", kind: "short" },
  { field: "quienesSomos", section: "negocio", kind: "long" },
  { field: "presupuesto", section: "negocio", kind: "short" },
  { field: "edad", section: "cliente", kind: "multi", options: AGES },
  { field: "sexo", section: "cliente", kind: "choice", options: SEXES },
  {
    field: "poderAdquisitivo",
    section: "cliente",
    kind: "multi",
    options: INCOME,
    max: INCOME_MAX,
  },
  { field: "estudios", section: "cliente", kind: "choice", options: STUDIES },
  { field: "gustos", section: "cliente", kind: "long" },
  { field: "miedos", section: "cliente", kind: "long" },
  { field: "suenos", section: "cliente", kind: "long" },
  {
    field: "clienteNoIdeal",
    section: "cliente",
    kind: "choice",
    options: SI_NO,
  },
  { field: "noIdealDescripcion", section: "cliente", kind: "long" },
  { field: "otroPerfil", section: "cliente", kind: "choice", options: SI_NO },
  { field: "otroPerfilDescripcion", section: "cliente", kind: "long" },
  { field: "colores", section: "diseno", kind: "long" },
  { field: "tipografias", section: "diseno", kind: "long" },
  { field: "estilo", section: "diseno", kind: "long" },
];

export type StrategicAnswersDraft = Partial<
  Record<StrategicField, string | string[]>
>;

// Questions shown, in order, given the answers so far. As in Microsoft
// Forms, "No" skips the "Descríbelo" that follows it.
export function strategicQuestions(a: StrategicAnswersDraft) {
  return ALL_QUESTIONS.filter((q) => {
    if (q.field === "noIdealDescripcion") return a.clienteNoIdeal === "SI";
    if (q.field === "otroPerfilDescripcion") return a.otroPerfil === "SI";
    return true;
  });
}

export const STRATEGIC_FIELDS = ALL_QUESTIONS.map((q) => q.field);

const short = z.string().trim().min(1, "Obligatoria").max(2000);
const long = z.string().trim().min(1, "Obligatoria").max(10000);
const many = <T extends readonly [string, ...string[]]>(options: T, max = 10) =>
  z
    .array(z.enum(options))
    .min(1, "Elegí al menos una opción")
    .max(max, `Elegí hasta ${max}`)
    .transform((values) => options.filter((o) => values.includes(o)));

export const strategicAnswersSchema = z
  .object({
    nombreFantasia: short,
    historia: long,
    palabrasClave: short,
    competidores: long,
    zona: short,
    resaltar: short,
    lanzamientos: z.enum(LAUNCHES),
    debilidades: long,
    fortalezas: long,
    espiritu: long,
    sentimientos: long,
    personalidad: long,
    slogan: short,
    quienesSomos: long,
    presupuesto: short,
    edad: many(AGES),
    sexo: z.enum(SEXES),
    poderAdquisitivo: many(INCOME, INCOME_MAX),
    estudios: z.enum(STUDIES),
    gustos: long,
    miedos: long,
    suenos: long,
    clienteNoIdeal: z.enum(SI_NO),
    noIdealDescripcion: long.optional(),
    otroPerfil: z.enum(SI_NO),
    otroPerfilDescripcion: long.optional(),
    colores: long,
    tipografias: long,
    estilo: long,
  })
  .superRefine((a, ctx) => {
    if (a.clienteNoIdeal === "SI" && !a.noIdealDescripcion)
      ctx.addIssue({
        code: "custom",
        path: ["noIdealDescripcion"],
        message: "Obligatoria",
      });
    if (a.otroPerfil === "SI" && !a.otroPerfilDescripcion)
      ctx.addIssue({
        code: "custom",
        path: ["otroPerfilDescripcion"],
        message: "Obligatoria",
      });
  })
  // Answers to questions that weren't shown are dropped.
  .transform((a) => ({
    ...a,
    noIdealDescripcion:
      a.clienteNoIdeal === "SI" ? a.noIdealDescripcion : undefined,
    otroPerfilDescripcion:
      a.otroPerfil === "SI" ? a.otroPerfilDescripcion : undefined,
  }));

export type StrategicAnswers = z.output<typeof strategicAnswersSchema>;
export type StrategicAnswersInput = z.input<typeof strategicAnswersSchema>;

// A draft: whatever was typed so far, unchecked except for size. Unknown
// keys are dropped.
export const strategicDraftSchema = z
  .record(
    z.string().max(64),
    z.union([z.string().max(10000), z.array(z.string().max(200)).max(10)]),
  )
  .transform((record) => {
    const draft: StrategicAnswersDraft = {};
    for (const field of STRATEGIC_FIELDS) {
      const value = record[field];
      if (value !== undefined) draft[field] = value;
    }
    return draft;
  });

// The answer as it reads in the brief: lists joined, nothing else changed.
export function answerText(value: string | string[] | undefined) {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}
