import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { Preview } from "@react-email/preview";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import { env } from "next-runtime-env";
import * as React from "react";

// Impeesa: invitation email in Spanish with the Impeesa brand (blue #2E5469,
// gold #AB8B4C). The logo is a PNG served by the panel (apps/web/public),
// because most mail apps don't show SVG.

const BLUE = "#2E5469";
const GOLD = "#AB8B4C";
const TEXT = "#232323";
const MUTED = "#6b7280";

const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: TEXT,
  margin: "0 0 16px",
};

const listItem = { ...paragraph, margin: "0 0 8px" };

export const JoinWorkspaceTemplate = ({
  magicLoginUrl,
  inviterName,
  workspaceName,
}: {
  magicLoginUrl?: string;
  inviterName?: string;
  workspaceName?: string;
}) => {
  const baseUrl =
    env("NEXT_PUBLIC_BASE_URL") ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const inviter = inviterName?.trim().split(/\s+/)[0];

  return (
    <Html lang="es">
      <Head />
      <Preview>Tu acceso al Panel de control de Impeesa</Preview>
      <Body
        style={{ backgroundColor: "#f4f5f7", margin: 0, padding: "24px 0" }}
      >
        <Container
          style={{
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            borderTop: `4px solid ${GOLD}`,
            padding: "32px 28px",
          }}
        >
          <Img
            src={`${baseUrl}/email-logo.png`}
            alt="Impeesa Marketing"
            width="200"
            height="58"
            style={{ margin: "0 0 28px" }}
          />

          <Heading
            as="h1"
            style={{
              fontSize: "22px",
              lineHeight: "1.3",
              fontWeight: "bold",
              color: BLUE,
              margin: "0 0 16px",
            }}
          >
            {inviter
              ? `${inviter} te invitó al Panel de control de Impeesa`
              : "Te invitaron al Panel de control de Impeesa"}
          </Heading>

          <Text style={paragraph}>
            Te damos la bienvenida al equipo
            {workspaceName ? ` de ${workspaceName}` : ""}. En el panel
            organizamos el trabajo: las tareas de cada cliente, sus carpetas y
            briefs, y el registro de horas.
          </Text>

          <Section style={{ margin: "8px 0 28px" }}>
            <Button
              target="_blank"
              href={magicLoginUrl}
              style={{
                backgroundColor: BLUE,
                borderRadius: "6px",
                padding: "14px 28px",
                fontSize: "15px",
                fontWeight: "bold",
                color: "#ffffff",
              }}
            >
              Entrar al panel
            </Button>
          </Section>

          <Text
            style={{
              ...paragraph,
              fontWeight: "bold",
              color: BLUE,
              margin: "0 0 8px",
            }}
          >
            Para no perderte nada desde el celular
          </Text>
          <Text style={listItem}>
            • En el menú de la izquierda tocá <b>"Activar avisos"</b> y aceptá
            el permiso. Te va a llegar un aviso cuando una tarea en la que sos
            responsable necesite algo de vos.
          </Text>
          <Text style={listItem}>
            • <b>iPhone:</b> abrí el panel en Safari, tocá{" "}
            <i>Compartir → Agregar a inicio</i> y entrá desde ese ícono. Si no,
            los avisos no funcionan.
          </Text>
          <Text style={{ ...listItem, margin: "0 0 24px" }}>
            • <b>Android:</b> con Chrome alcanza.
          </Text>

          <Text style={{ ...paragraph, fontSize: "13px", color: MUTED }}>
            El botón vale por un tiempo limitado. Si venció o tenés algún
            problema para entrar, respondé este correo.
          </Text>

          <Hr style={{ borderColor: "#e5e7eb", margin: "24px 0 16px" }} />
          <Text style={{ fontSize: "12px", color: MUTED, margin: 0 }}>
            Impeesa Marketing · Panel de control
            <br />
            Si no esperabas esta invitación, podés ignorar este correo.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default JoinWorkspaceTemplate;
