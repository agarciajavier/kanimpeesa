import { z } from "zod";

// Impeesa onboarding: the administrative form ("ficha inicial"), copied from
// the Microsoft Forms one (gL4nHDEhyc) word for word, with the change Ángel
// approved on 13/11: the store question asks only for the email the store
// was created with, never a password.
//
// Pure data and validation: used both by the public page and by the server,
// which validates again and never trusts the browser.

export const ADMIN_FORM_VERSION = 1;

export const SERVICES = [
  "Administración y gestión de publicidad en RRSS",
  "Administración y gestión de publicidad integral",
  "Asesoría - Plan Básico",
  "Asesoría - Plan Medio",
  "Asesoría - Plan Full",
] as const;

export const TAX_STATUSES = [
  "Responsable Inscripto",
  "Monotributista",
  "Consumidor final (no inscripto en ARCA)",
  "Residente fuera de Argentina",
] as const;

export const PLATFORMS = [
  "Tienda nube",
  "Empretienda",
  "Shopify",
  "Woocommerce",
  "Desarrollo propio",
  "Otras",
] as const;

export const YES_NO = ["SI", "NO"] as const;
// Written "No" in the original store question.
export const STORE_YES_NO = ["SI", "No"] as const;

export const ADMIN_TEXT = {
  razonSocial: {
    label: "Razón social",
    help: "Nombre LEGAL de tu negocio, si sos monotributista es tu nombre y apellido",
  },
  nombreFantasia: {
    label: "Nombre de fantasía del negocio",
    help: "Recordalo en el siguiente formulario te vamos a pedir que pongas el mismo",
  },
  servicio: { label: "Servicio contratado" },
  nombreContacto: { label: "Nombre de contacto" },
  telefono: { label: "Teléfono de contacto con WhatsApp" },
  correoContacto: { label: "Correo de contacto" },
  facturaMismoCorreo: {
    label:
      "Correo para enviar la factura es el mismo que el correo de contacto?",
  },
  correoFactura: { label: "Correo donde enviar la factura" },
  situacionFiscal: { label: "Situación Fiscal" },
  cuit: {
    label: "CUIT",
    help: "INGRESA LOS 11 NÚMEROS DEL CUIT SIN GUIONES NI PUNTOS",
  },
  dni: { label: "DNI" },
  idFiscalExterior: { label: "Identificador fiscal de tu país" },
  instagram: { label: "Instagram del negocio" },
  tieneTienda: { label: "Tenés tienda online?" },
  plataforma: { label: "Plataforma" },
  correoTiendanube: {
    label: "Correo principal de tienda nube",
    help: "Es el correo con el que creaste la tienda, solo el correo vamos a pedir acceso desde el panel de socios",
  },
  correoTienda: {
    label: "Correo con el que se creó la tienda",
    help: "Solo necesitamos el correo: desde ahí te vamos a pedir acceso a la tienda por invitación. No compartas contraseñas.",
  },
} as const;

export type AdminField = keyof typeof ADMIN_TEXT;

const text = (max = 255) => z.string().trim().max(max);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Ingresá un correo válido")
  .max(320);

export const adminAnswersSchema = z
  .object({
    razonSocial: text().min(1),
    nombreFantasia: text().min(1),
    servicio: z.enum(SERVICES),
    nombreContacto: text().min(1),
    telefono: text(50).min(6),
    correoContacto: email,
    facturaMismoCorreo: z.enum(YES_NO),
    correoFactura: email.optional(),
    situacionFiscal: z.enum(TAX_STATUSES),
    cuit: text(20).optional(),
    dni: text(20).optional(),
    idFiscalExterior: text(64).optional(),
    instagram: text().optional(),
    tieneTienda: z.enum(STORE_YES_NO),
    plataforma: z.enum(PLATFORMS).optional(),
    correoTiendanube: email.optional(),
    correoTienda: email.optional(),
  })
  .superRefine((a, ctx) => {
    const need = (field: AdminField, ok: boolean, message = "Obligatoria") => {
      if (!ok) ctx.addIssue({ code: "custom", path: [field], message });
    };
    need("correoFactura", a.facturaMismoCorreo === "SI" || !!a.correoFactura);
    if (
      a.situacionFiscal === "Responsable Inscripto" ||
      a.situacionFiscal === "Monotributista"
    )
      need(
        "cuit",
        /^\d{11}$/.test(a.cuit ?? ""),
        "Tienen que ser los 11 números, sin guiones ni puntos",
      );
    if (a.situacionFiscal === "Consumidor final (no inscripto en ARCA)")
      need("dni", !!a.dni);
    if (a.situacionFiscal === "Residente fuera de Argentina")
      need("idFiscalExterior", !!a.idFiscalExterior);
    if (a.tieneTienda === "SI") {
      need("plataforma", !!a.plataforma);
      if (a.plataforma === "Tienda nube")
        need("correoTiendanube", !!a.correoTiendanube);
      else if (a.plataforma && a.plataforma !== "Otras")
        need("correoTienda", !!a.correoTienda);
    }
  })
  // Answers to questions that weren't shown are dropped, so they never
  // reach the Sheet.
  .transform((a) => ({
    ...a,
    correoFactura: a.facturaMismoCorreo === "NO" ? a.correoFactura : undefined,
    cuit:
      a.situacionFiscal === "Responsable Inscripto" ||
      a.situacionFiscal === "Monotributista"
        ? a.cuit
        : undefined,
    dni:
      a.situacionFiscal === "Consumidor final (no inscripto en ARCA)"
        ? a.dni
        : undefined,
    idFiscalExterior:
      a.situacionFiscal === "Residente fuera de Argentina"
        ? a.idFiscalExterior
        : undefined,
    instagram: a.instagram || undefined,
    plataforma: a.tieneTienda === "SI" ? a.plataforma : undefined,
    correoTiendanube:
      a.tieneTienda === "SI" && a.plataforma === "Tienda nube"
        ? a.correoTiendanube
        : undefined,
    correoTienda:
      a.tieneTienda === "SI" &&
      a.plataforma &&
      !["Tienda nube", "Otras"].includes(a.plataforma)
        ? a.correoTienda
        : undefined,
  }));

export type AdminAnswers = z.output<typeof adminAnswersSchema>;
export type AdminAnswersInput = z.input<typeof adminAnswersSchema>;
