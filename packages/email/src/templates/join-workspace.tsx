import { Text } from "@react-email/text";
import * as React from "react";

import {
  BLUE,
  BrandButton,
  BrandLayout,
  paragraph,
  smallNote,
} from "../components/BrandLayout";

// Impeesa: invitation email in Spanish with the Impeesa brand.

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
  const inviter = inviterName?.trim().split(/\s+/)[0];

  return (
    <BrandLayout
      preview="Tu acceso al Panel de control de Impeesa"
      title={
        inviter
          ? `${inviter} te invitó al Panel de control de Impeesa`
          : "Te invitaron al Panel de control de Impeesa"
      }
      footerNote="Si no esperabas esta invitación, podés ignorar este correo."
    >
      <Text style={paragraph}>
        Te damos la bienvenida al equipo
        {workspaceName ? ` de ${workspaceName}` : ""}. En el panel organizamos
        el trabajo: las tareas de cada cliente, sus carpetas y briefs, y el
        registro de horas.
      </Text>

      <BrandButton href={magicLoginUrl}>Entrar al panel</BrandButton>

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
        • En el menú de la izquierda tocá <b>"Activar avisos"</b> y aceptá el
        permiso. Te va a llegar un aviso cuando una tarea en la que sos
        responsable necesite algo de vos.
      </Text>
      <Text style={listItem}>
        • <b>iPhone:</b> abrí el panel en Safari, tocá{" "}
        <i>Compartir → Agregar a inicio</i> y entrá desde ese ícono. Si no, los
        avisos no funcionan.
      </Text>
      <Text style={{ ...listItem, margin: "0 0 24px" }}>
        • <b>Android:</b> con Chrome alcanza.
      </Text>

      <Text style={smallNote}>
        El botón vale por un tiempo limitado. Si venció o tenés algún problema
        para entrar, respondé este correo.
      </Text>
    </BrandLayout>
  );
};

export default JoinWorkspaceTemplate;
