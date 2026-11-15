// Impeesa onboarding settings. Secrets (Google key, Resend key) only come from
// Railway variables; the ids below are not secret.

// Board "Onboarding" and its list "Nuevo cliente", where new clients' cards
// are created.
export const ONBOARDING_BOARD_PUBLIC_ID = "aer1quw6tanu";
export const ONBOARDING_NEW_CLIENT_LIST_PUBLIC_ID = "m97jjdjziqvp";

// The REAL billing Sheet. The email templates are read from its notes (cells
// D5 and D6 of "Control automatización"); reading never changes it. Client
// rows are written to it only in live mode.
export const REAL_SHEET_ID = "1bjaS_5Oqklymyy_lPwHYpvrdQt674ORm7ukTazyTQ-0";
// The REAL "Clientes Impeesa" folder: only used in live mode.
export const REAL_CLIENTS_FOLDER_ID = "1wTXRm6zm5PAhK9bFqMmctgpr2Gsbagvg";

export const TEMPLATE_TAB = "Control automatización";
export const WELCOME_TEMPLATE_CELL = "D5";
export const ONBOARDING_TEMPLATE_CELL = "D6";
export const CLIENTS_TAB = "Clientes";

// The administrative form link inside the welcome template. It is replaced by
// the client's own link to the panel's form.
export const MS_FORMS_ADMIN_URL = "https://forms.cloud.microsoft/r/gL4nHDEhyc";
// The strategic form link inside the second email (D6), under either of
// Microsoft's domains. Replaced by the client's link to the panel's form.
export const MS_FORMS_STRATEGIC_URL =
  /https:\/\/forms\.(?:office\.com|cloud\.microsoft)\/r\/UEubFsb6J1/;

export const SENDER =
  "Administración Impeesa Marketing <administracion@impeesamarketing.com>";
export const REPLY_TO = "administracion@impeesamarketing.com";
export const GOOGLE_SUBJECT = "administracion@impeesamarketing.com";

export const SUBFOLDERS = [
  "Diseños",
  "Material Gráfico",
  "Marca",
  "Referencias",
] as const;

export interface OnboardingTargets {
  isTest: boolean;
  sheetId: string;
  clientsFolderId: string;
  // Where client emails go. In test mode every email goes to the test inbox.
  redirectTo: string | null;
  subjectPrefix: string;
}

// Live mode (real clients, real Sheet, real folder) stays off until Ángel
// authorizes it: ONBOARDING_MODE must be set to "live" by hand.
export function isLiveMode() {
  return process.env.ONBOARDING_MODE === "live";
}

export function alertEmail() {
  return process.env.ONBOARDING_ALERT_EMAIL ?? "angel@impeesamarketing.com";
}

export function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://panel.impeesamarketing.com"
  ).replace(/\/$/, "");
}

export function getTargets(isTest: boolean): OnboardingTargets {
  if (!isTest) {
    return {
      isTest,
      sheetId: REAL_SHEET_ID,
      clientsFolderId: REAL_CLIENTS_FOLDER_ID,
      redirectTo: null,
      subjectPrefix: "",
    };
  }

  const sheetId = process.env.ONBOARDING_TEST_SHEET_ID;
  const clientsFolderId = process.env.ONBOARDING_TEST_FOLDER_ID;
  if (!sheetId || !clientsFolderId)
    throw new Error(
      "Faltan ONBOARDING_TEST_SHEET_ID u ONBOARDING_TEST_FOLDER_ID en Railway",
    );
  // A test must never touch the real Sheet or folder.
  if (sheetId === REAL_SHEET_ID || clientsFolderId === REAL_CLIENTS_FOLDER_ID)
    throw new Error("El modo prueba apunta al Sheet o a la carpeta reales");

  return {
    isTest,
    sheetId,
    clientsFolderId,
    redirectTo:
      process.env.ONBOARDING_TEST_EMAIL ?? "angel@impeesamarketing.com",
    subjectPrefix: "[PRUEBA] ",
  };
}
