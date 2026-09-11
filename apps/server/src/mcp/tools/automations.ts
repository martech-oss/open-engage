import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

import { AutomationQueryRepository } from "@openengage/database/automations";
import { ContactRepository } from "@openengage/database/contacts";

import { hasWorkspaceRole } from "../../auth/authorization";
import { enrollContactManually } from "../../automations/enrollment";
import { listAutomations, normalizeAutomationStatus } from "../../automations/list-service";
import { consumeAutomationConfirmation, createAutomationConfirmation } from "../confirmation-store";
import { jsonResult, toolError } from "../result";
import type { McpToolContext } from "../types";

export function registerAutomationTools(server: McpServer, context: McpToolContext): void {
  server.registerTool(
    "list_automations",
    {
      title: "List OpenEngage automations",
      description: "List automations and their current status.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => jsonResult(await listAutomations(context.database, context.workspace.workspaceId)),
  );

  server.registerTool(
    "get_automation_draft",
    {
      title: "Get automation draft",
      description: "Read the editable automation graph.",
      inputSchema: { automationId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ automationId }) => {
      const draft = await new AutomationQueryRepository(
        context.database,
        context.workspace,
      ).getDraft(automationId);
      return draft
        ? jsonResult({ graph: draft.graph, status: normalizeAutomationStatus(draft.status) })
        : toolError("Automation was not found.");
    },
  );

  server.registerTool(
    "prepare_automation_enrollment",
    {
      title: "Prepare automation enrollment",
      description:
        "Prepare, but do not execute, a contact enrollment. The confirmation token expires in five minutes.",
      inputSchema: {
        automationId: z.string().min(1),
        contactId: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ automationId, contactId }) => {
      const [automation, contact] = await Promise.all([
        new AutomationQueryRepository(context.database, context.workspace).getDraft(automationId),
        new ContactRepository(context.database, context.workspace).getContact(contactId),
      ]);
      if (!automation) return toolError("Automation was not found.");
      if (!contact) return toolError("Contact was not found.");
      const confirmation = await createAutomationConfirmation(
        context.database,
        context.workspace.workspaceId,
        context.workspace.apiKeyId,
        { automationId, contactId },
      );
      return jsonResult({
        requiresConfirmation: true,
        confirmationToken: confirmation.token,
        expiresAt: confirmation.expiresAt,
        warning:
          "This enrollment can trigger real email or webhook delivery. Call confirm_automation_enrollment with confirmation exactly CONFIRM SEND.",
        automation: { id: automationId, name: automation.graph.name },
        contact: { id: contact.id, email: contact.email },
      });
    },
  );

  server.registerTool(
    "confirm_automation_enrollment",
    {
      title: "Confirm automation enrollment",
      description:
        "Enroll a contact only after explicit user confirmation. This can trigger a real delivery.",
      inputSchema: {
        confirmationToken: z.string().uuid(),
        confirmation: z.literal("CONFIRM SEND"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ confirmationToken }) => {
      if (!hasWorkspaceRole(context.workspace.role, "marketer")) {
        return toolError("A marketer or higher workspace role is required.");
      }
      const pending = await consumeAutomationConfirmation(
        context.database,
        context.workspace.workspaceId,
        context.workspace.apiKeyId,
        confirmationToken,
      );
      if (!pending) return toolError("Confirmation token is invalid or expired.");
      const outcome = await enrollContactManually(context.database, {
        workspaceId: context.workspace.workspaceId,
        automationId: pending.automationId,
        contactId: pending.contactId,
        sourceEventId: confirmationToken,
      });
      switch (outcome.kind) {
        case "not_active":
          return toolError("Automation is not active.");
        case "source_missing":
          return toolError("Automation source node is missing.");
        case "already_enrolled":
          return toolError("Contact is already enrolled for this confirmation.");
        case "enrolled":
          return jsonResult(outcome.result);
      }
    },
  );
}
