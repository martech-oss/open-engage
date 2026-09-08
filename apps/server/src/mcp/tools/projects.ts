import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { projectsContract } from "@openengage/orpc";

import { registerRpcTool } from "../rpc-tool";
import type { McpToolContext } from "../types";

export function registerProjectTools(server: McpServer, context: McpToolContext): void {
  const api = context.rpc.projects;
  const contract = projectsContract;
  const read = { readOnly: true };

  registerRpcTool(
    server,
    "list_projects",
    "List projects in the API key's workspace.",
    undefined,
    () => api.list(),
    read,
  );
  registerRpcTool(
    server,
    "create_project",
    "Create a project that can have a program definition and members.",
    contract.create["~orpc"].inputSchema,
    api.create,
  );
  registerRpcTool(
    server,
    "get_project_program_catalog",
    "List projects and the caller's project creation permission.",
    undefined,
    () => api.programCatalog(),
    read,
  );
  registerRpcTool(
    server,
    "get_project_program",
    "Read project details, editable and published program definitions, version history and allowed actions.",
    contract.programGet["~orpc"].inputSchema,
    api.programGet,
    read,
  );
  registerRpcTool(
    server,
    "save_project_program",
    "Create or update the draft program definition using expectedRowVersion (0 for the first definition).",
    contract.programSave["~orpc"].inputSchema,
    api.programSave,
  );
  registerRpcTool(
    server,
    "publish_project_program",
    "Publish the reviewed program definition with its expectedRowVersion and confirmed=true. Existing members retain their definition version.",
    contract.programPublish["~orpc"].inputSchema,
    api.programPublish,
  );
  registerRpcTool(
    server,
    "list_project_members",
    "Search and paginate program members by contact or status.",
    contract.memberList["~orpc"].inputSchema,
    api.memberList,
    read,
  );
  registerRpcTool(
    server,
    "mutate_project_member",
    "Register or advance a member using an idempotencyKey. Corrections require mode=correction, source=manual and a reason; expectedRevision detects stale updates.",
    contract.memberMutate["~orpc"].inputSchema,
    api.memberMutate,
    { idempotent: true },
  );
  registerRpcTool(
    server,
    "import_project_members",
    "Accept a resumable CSV import (max 1000 rows) using an idempotencyKey. Returns jobId and progress; poll get_project_member_import for row errors. Changed CSV with the same key conflicts.",
    contract.memberImport["~orpc"].inputSchema,
    api.memberImport,
    { idempotent: true },
  );
  registerRpcTool(
    server,
    "get_project_member_import",
    "Read CSV import progress and ordered row results using the accepted jobId.",
    contract.memberImportGet["~orpc"].inputSchema,
    api.memberImportGet,
    read,
  );
  registerRpcTool(
    server,
    "get_project_member_history",
    "Read a member's status transitions and corrections.",
    contract.memberHistory["~orpc"].inputSchema,
    api.memberHistory,
    read,
  );
  registerRpcTool(
    server,
    "get_project_program_cohort",
    "Measure success for the joined-at cohort [from,to) as of asOf, including time to first success.",
    contract.programCohort["~orpc"].inputSchema,
    api.programCohort,
    read,
  );
  registerRpcTool(
    server,
    "bind_project_program_form",
    "Set or remove an explicit published program binding for a form with confirmed=true; binding=null removes it.",
    contract.programBindForm["~orpc"].inputSchema,
    api.programBindForm,
  );
}
