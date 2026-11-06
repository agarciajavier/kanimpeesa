import { Text } from "@react-email/text";
import * as React from "react";

import {
  BrandButton,
  BrandLayout,
  paragraph,
  smallNote,
} from "../components/BrandLayout";

// Impeesa: password reset, in Spanish with the Impeesa brand.

export const ResetPasswordTemplate = ({
  resetPasswordUrl,
}: {
  resetPasswordUrl?: string;
  resetPasswordToken?: string;
}) => (
  <BrandLayout
    preview="Elegí una contraseña nueva para el Panel de control"
    title="Elegí una contraseña nueva"
    footerNote="Si no pediste cambiar la contraseña, podés ignorar este correo: la actual sigue funcionando."
  >
    <Text style={paragraph}>
      Pediste cambiar la contraseña del Panel de control de Impeesa. Tocá el
      botón para elegir una nueva.
    </Text>

    <BrandButton href={resetPasswordUrl}>Cambiar contraseña</BrandButton>

    <Text style={smallNote}>
      El botón vale por un tiempo limitado. Si venció, volvé a tocar "Olvidé mi
      contraseña" en la pantalla de ingreso.
    </Text>
  </BrandLayout>
);

export default ResetPasswordTemplate;
