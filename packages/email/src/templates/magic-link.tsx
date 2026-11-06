import { Text } from "@react-email/text";
import * as React from "react";

import {
  BrandButton,
  BrandLayout,
  paragraph,
  smallNote,
} from "../components/BrandLayout";

// Impeesa: sign in without a password, in Spanish with the Impeesa brand.

export const MagicLinkTemplate = ({
  magicLoginUrl,
}: {
  magicLoginUrl?: string;
}) => (
  <BrandLayout
    preview="Tu enlace para entrar al Panel de control"
    title="Entrá al Panel de control"
    footerNote="Si no pediste entrar, podés ignorar este correo."
  >
    <Text style={paragraph}>
      Tocá el botón para entrar al panel sin escribir tu contraseña.
    </Text>

    <BrandButton href={magicLoginUrl}>Entrar al panel</BrandButton>

    <Text style={smallNote}>
      El botón sirve una sola vez y por un tiempo limitado. Si venció, pedí uno
      nuevo desde la pantalla de ingreso.
    </Text>
  </BrandLayout>
);

export default MagicLinkTemplate;
