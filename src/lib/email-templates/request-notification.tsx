import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface RequestNotificationProps {
  heading?: string;
  message?: string;
  link?: string;
}

/**
 * Thin, detail-free request notification. Deliberately carries no dates,
 * leave types, or medical details — recipients open the app for specifics.
 */
function RequestNotification({
  heading = "Shift & Leave Manager",
  message = "You have a new update waiting for you.",
  link,
}: RequestNotificationProps) {
  return (
    <Html>
      <Head />
      <Preview>{message}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Hr style={hr} />
          <Section>
            <Text style={text}>{message}</Text>
            {link ? (
              <Text style={text}>
                <Link href={link} style={button}>
                  Open the app
                </Link>
              </Text>
            ) : null}
            <Text style={muted}>
              Sign in to view the details. For privacy, specifics are only
              available inside the app.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f6f5f1",
  fontFamily: "Arial, Helvetica, sans-serif",
  margin: 0,
  padding: "24px 0",
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "24px",
};
const h1: React.CSSProperties = {
  color: "#1f2a37",
  fontSize: "20px",
  margin: "0 0 8px",
};
const hr: React.CSSProperties = { borderColor: "#e5e2da", margin: "12px 0" };
const text: React.CSSProperties = {
  color: "#1f2a37",
  fontSize: "15px",
  lineHeight: "22px",
};
const muted: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  marginTop: "16px",
};
const button: React.CSSProperties = {
  backgroundColor: "#0f6b4f",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 600,
  padding: "10px 18px",
  textDecoration: "none",
};

export const template = {
  component: RequestNotification,
  subject: (data: Record<string, any>) =>
    data.subject || "You have a new update in Shift & Leave Manager",
  displayName: "Request notification",
  previewData: {
    message: "Your leave request has a new decision.",
    link: "https://example.com",
  },
} satisfies TemplateEntry;
