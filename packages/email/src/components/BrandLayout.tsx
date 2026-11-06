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

// Impeesa: shared look of every email the panel sends (blue #2E5469, gold
// #AB8B4C). The logo is a PNG served by the panel (apps/web/public),
// because most mail apps don't show SVG.

export const BLUE = "#2E5469";
export const GOLD = "#AB8B4C";
export const TEXT = "#232323";
export const MUTED = "#6b7280";

export const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: TEXT,
  margin: "0 0 16px",
};

export const smallNote = { ...paragraph, fontSize: "13px", color: MUTED };

export function BrandLayout({
  preview,
  title,
  footerNote,
  children,
}: {
  preview: string;
  title: string;
  // Grey line under the footer, e.g. "If you didn't ask for this...".
  footerNote?: string;
  children: React.ReactNode;
}) {
  const baseUrl =
    env("NEXT_PUBLIC_BASE_URL") ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";

  return (
    <Html lang="es">
      <Head />
      <Preview>{preview}</Preview>
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
            {title}
          </Heading>

          {children}

          <Hr style={{ borderColor: "#e5e7eb", margin: "24px 0 16px" }} />
          <Text style={{ fontSize: "12px", color: MUTED, margin: 0 }}>
            Impeesa Marketing · Panel de control
            {footerNote && (
              <>
                <br />
                {footerNote}
              </>
            )}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function BrandButton({
  href,
  children,
}: {
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <Section style={{ margin: "8px 0 28px" }}>
      <Button
        target="_blank"
        href={href}
        style={{
          backgroundColor: BLUE,
          borderRadius: "6px",
          padding: "14px 28px",
          fontSize: "15px",
          fontWeight: "bold",
          color: "#ffffff",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}
