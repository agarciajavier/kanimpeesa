import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { KanClient } from "../client.js";

// Impeesa: workspace clients, their Drive folder and brief, and Drive links
// on cards. Mirrors routers/client.ts and routers/cardLink.ts in @kan/api.

const statusSchema = z
  .enum(["starting", "ok", "at_risk", "critical", "paused", "lost"])
  .describe(
    "Client status: starting (Iniciando), ok (Correcto), at_risk (En riesgo), critical (Crítico), paused (En pausa), lost (Perdido)",
  );

const result = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerClientTools(
  server: McpServer,
  client: KanClient,
): void {
  server.tool(
    "list_clients",
    "List the clients of a workspace with their status, Drive folder, brief, summary and task count. Use it to check whether a client already exists before creating it.",
    {
      workspacePublicId: z.string().describe("The workspace's public ID"),
    },
    async ({ workspacePublicId }) =>
      result(
        await client.request(
          "GET",
          `/workspaces/${workspacePublicId}/clients/overview`,
        ),
      ),
  );

  server.tool(
    "create_client",
    "Create a client in a workspace, optionally with its Google Drive folder, the link to its brief and a short summary. Every card of the client shows the folder.",
    {
      workspacePublicId: z.string().describe("The workspace's public ID"),
      name: z.string().max(60).describe("Client or brand name"),
      status: statusSchema.optional(),
      driveUrl: z
        .string()
        .url()
        .optional()
        .describe("Full https link to the client's Google Drive folder"),
      briefUrl: z
        .string()
        .url()
        .optional()
        .describe("Full https link to the client's brief (e.g. a Google Doc)"),
      summary: z
        .string()
        .max(2000)
        .optional()
        .describe("Short summary of the client: what it sells, goals, tone"),
    },
    async ({ workspacePublicId, ...body }) =>
      result(
        await client.request(
          "POST",
          `/workspaces/${workspacePublicId}/clients`,
          body,
        ),
      ),
  );

  server.tool(
    "update_client",
    "Update a client. name and status are required (send the current ones to keep them); driveUrl, briefUrl and summary are kept when left out and removed when null.",
    {
      clientPublicId: z.string().describe("The client's public ID"),
      name: z.string().max(60).describe("Client name"),
      status: statusSchema,
      driveUrl: z.string().url().nullable().optional(),
      briefUrl: z.string().url().nullable().optional(),
      summary: z.string().max(2000).nullable().optional(),
    },
    async ({ clientPublicId, ...body }) =>
      result(await client.request("PUT", `/clients/${clientPublicId}`, body)),
  );

  server.tool(
    "set_card_client",
    "Assign a client to a card, or remove it with clientPublicId null",
    {
      cardPublicId: z.string().describe("The card's public ID"),
      clientPublicId: z
        .string()
        .nullable()
        .describe("The client's public ID, or null to remove it"),
    },
    async ({ cardPublicId, clientPublicId }) =>
      result(
        await client.request("PUT", `/cards/${cardPublicId}/client`, {
          clientPublicId,
        }),
      ),
  );

  server.tool(
    "add_card_link",
    "Add a link to a Google Drive file or folder (or any web page) to a card. Drive links can be previewed inside the card.",
    {
      cardPublicId: z.string().describe("The card's public ID"),
      title: z.string().max(255).describe("Name shown on the card, e.g. Brief"),
      url: z.string().url().describe("Full https link"),
    },
    async ({ cardPublicId, title, url }) =>
      result(
        await client.request("POST", `/cards/${cardPublicId}/links`, {
          title,
          url,
        }),
      ),
  );
}
