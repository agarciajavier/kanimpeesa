import { Text } from "@react-email/text";
import * as React from "react";

import { BrandButton, BrandLayout, paragraph } from "../components/BrandLayout";

// Impeesa: someone @-mentioned the reader in a card comment, in Spanish with
// the Impeesa brand.

export const MentionTemplate = ({
  commenterName,
  boardName,
  cardTitle,
  cardUrl,
}: {
  commenterName: string;
  boardName: string;
  cardTitle: string;
  cardUrl: string;
}) => (
  <BrandLayout
    preview={`${commenterName} te mencionó en ${cardTitle}`}
    title="Te mencionaron en una tarea"
  >
    <Text style={paragraph}>
      <strong>{commenterName}</strong> te mencionó en un comentario de la tarea{" "}
      <strong>{cardTitle}</strong>, en el tablero <strong>{boardName}</strong>.
    </Text>

    <BrandButton href={cardUrl}>Ver la tarea</BrandButton>
  </BrandLayout>
);

export default MentionTemplate;
