import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import type { SessionAccess, WorkspaceAccess } from "../auth/access";
import type { RuntimeEnv, SessionValue } from "../env";
import type { AccessResolvers } from "./access-cache";

type SessionWorkspaceAccess = WorkspaceAccess & { session: SessionValue };

export interface OrpcInitialContext {
  database: OpenEngageDatabase;
  requestId: string;
  env: RuntimeEnv;
  headers: Headers;
  method: string;
  executionContext: {
    waitUntil(promise: Promise<unknown>): void;
  };
  access: AccessResolvers<WorkspaceAccess, SessionWorkspaceAccess, SessionAccess>;
}

export interface OrpcContext extends OrpcInitialContext {
  workspace: WorkspaceContext;
  session: SessionValue | null;
}
