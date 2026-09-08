import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { automationsContract } from "@openengage/orpc";

import { registerRpcTool } from "../rpc-tool";
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
    "Preview the published batch audience count and sample, returning versionId for start_automation_run.",
    contract.previewRun["~orpc"].inputSchema,
    api.previewRun,
    read,
  );
  registerRpcTool(
    server,
    "start_automation_run",
    "Start a batch with the preview's versionId and a stable requestId. This freezes targets and can trigger real email or webhook delivery.",
    contract.startRun["~orpc"].inputSchema,
    api.startRun,
    { idempotent: true, openWorld: true },
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
