import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import { automationsContract } from "@openengage/orpc";

import { hasWorkspaceRole } from "../../auth/authorization";
import { registerRpcTool } from "../rpc-tool";
import {
  consumeAutomationRunConfirmation,
  createAutomationRunConfirmation,
} from "../run-confirmation-store";
import type { McpToolContext } from "../types";

export function registerAutomationExecutionTools(server: McpServer, context: McpToolContext): void {
  const api = context.rpc.automations;
  const contract = automationsContract;
  const read = { readOnly: true };

  registerRpcTool(
    server,
    "get_automation_execution_options",
    "List available project statuses, callable automations and scoring categories for graph configuration.",
    undefined,
    () => api.executionOptions(),
    read,
  );
  registerRpcTool(
    server,
    "preview_automation_run",
    "Preview the published batch audience count and sample without starting it. Use prepare_automation_run to request user confirmation.",
    contract.previewRun["~orpc"].inputSchema,
    api.previewRun,
    read,
  );
  registerRpcTool(
    server,
    "prepare_automation_run",
    "Prepare, but do not start, a published batch. Show the audience and delivery warning to the user and obtain explicit confirmation before starting. The single-use token expires in five minutes.",
    contract.previewRun["~orpc"].inputSchema,
    async ({ id }) => {
      const preview = await api.previewRun({ id });
      const confirmation = await createAutomationRunConfirmation(
        context.database,
        context.workspace,
        id,
        preview.versionId,
      );
      return {
        ...preview,
        automationId: id,
        requiresConfirmation: true,
        confirmationToken: confirmation.token,
        expiresAt: confirmation.expiresAt,
        warning:
          "This batch can trigger real email or webhook delivery for its audience. Ask the user to explicitly confirm before calling start_automation_run with confirmation exactly CONFIRM SEND. The audience is frozen when the run starts.",
      };
    },
  );
  registerRpcTool(
    server,
    "start_automation_run",
    "Start the prepared batch only after explicit user confirmation. Requires the single-use token from prepare_automation_run and exact CONFIRM SEND acknowledgement. This freezes targets and can trigger real email or webhook delivery.",
    z.object({ confirmationToken: z.string().uuid(), confirmation: z.literal("CONFIRM SEND") }),
    async ({ confirmationToken }) => {
      if (!hasWorkspaceRole(context.workspace.role, "marketer"))
        throw new ORPCError("FORBIDDEN", {
          message: "A marketer or higher workspace role is required.",
        });
      const pending = await consumeAutomationRunConfirmation(
        context.database,
        context.workspace,
        confirmationToken,
      );
      if (!pending)
        throw new ORPCError("BAD_REQUEST", {
          message: "Confirmation token is invalid or expired.",
        });
      return api.startRun(pending);
    },
    { destructive: true, openWorld: true },
  );
  registerRpcTool(
    server,
    "list_automation_runs",
    "List batch run history and enrollment/flow progress.",
    contract.listRuns["~orpc"].inputSchema,
    api.listRuns,
    read,
  );
  registerRpcTool(
    server,
    "get_automation_run",
    "Read a run and its paginated frozen target ledger, including failures and enrollment/flow status.",
    contract.runDetail["~orpc"].inputSchema,
    api.runDetail,
    read,
  );
  registerRpcTool(
    server,
    "cancel_automation_run",
    "Cancel a batch run and its active enrollments and descendants.",
    contract.cancelRun["~orpc"].inputSchema,
    api.cancelRun,
    { destructive: true, idempotent: true },
  );
  registerRpcTool(
    server,
    "list_automation_enrollments",
    "List automation enrollment history, parent job links and the latest failure.",
    contract.listEnrollments["~orpc"].inputSchema,
    api.listEnrollments,
    read,
  );
  registerRpcTool(
    server,
    "get_automation_enrollment",
    "Read an enrollment's jobs and parent/child execution history.",
    contract.enrollmentDetail["~orpc"].inputSchema,
    api.enrollmentDetail,
    read,
  );
  registerRpcTool(
    server,
    "cancel_automation_enrollment",
    "Cancel an enrollment and its callable descendants.",
    contract.cancelEnrollment["~orpc"].inputSchema,
    api.cancelEnrollment,
    { destructive: true, idempotent: true },
  );

  const createSchema = contract.create["~orpc"].inputSchema!;
  // MCP discovery requires an object. The contract is graph AND (brief reference
  // OR no brief); advertise the optional reference fields from the contract and
  // retain the original intersection for validation in registerRpcTool and oRPC.
  const createToolSchema = createSchema.def.left.safeExtend(
    createSchema.def.right.options[0].partial().shape,
  );
  registerRpcTool(
    server,
    "create_automation",
    "Create an event, batch or callable automation draft, optionally tied to an approved project brief revision.",
    createSchema,
    api.create,
    { inputSchema: createToolSchema },
  );
  registerRpcTool(
    server,
    "get_automation_definition",
    "Read the complete editable automation graph and public API draft metadata using id.",
    contract.getDraft["~orpc"].inputSchema,
    api.getDraft,
    read,
  );
  registerRpcTool(
    server,
    "save_automation_draft",
    "Save an automation graph including schedule, audience, reentry, variables and callable configuration. Publish to apply changes.",
    contract.saveDraft["~orpc"].inputSchema,
    api.saveDraft,
  );
  registerRpcTool(
    server,
    "publish_automation",
    "Publish the draft and pin its variable and callable dependency versions. Publication can activate execution and delivery.",
    contract.publish["~orpc"].inputSchema,
    api.publish,
    { openWorld: true },
  );
  registerRpcTool(
    server,
    "set_automation_status",
    "Activate or pause a published automation. Activation can trigger delivery.",
    contract.setStatus["~orpc"].inputSchema,
    api.setStatus,
    { idempotent: true, openWorld: true },
  );
}
