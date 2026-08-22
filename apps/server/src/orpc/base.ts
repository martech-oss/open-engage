import { implement } from "@orpc/server";

import type { WorkspaceRole } from "@openengage/core/shared";
import { contract } from "@openengage/orpc";

import {
  resolveSessionWorkspaceAccess,
  resolveSessionAccess,
  resolveWorkspaceAccess,
  WorkspaceAccessError,
  type WorkspaceAccess,
} from "../auth/access";
import { hasWorkspaceRole } from "../auth/authorization";
import type { OrpcInitialContext } from "./context";

export const os = implement(contract).$context<OrpcInitialContext>();

type AccessInput = Pick<
  OrpcInitialContext,
  "database" | "env" | "headers" | "method" | "executionContext"
>;

type AccessErrorKey = "INVALID_API_KEY" | "ORIGIN_MISMATCH" | "WORKSPACE_REQUIRED" | "UNAUTHORIZED";

/**
 * Builds an oRPC middleware around one of the `resolve*WorkspaceAccess`
 * functions in `auth/access.ts`, mapping its `WorkspaceAccessError.code` to
 * the contract error each auth mode wants to raise for it.
 *
 * `resolve` is deliberately typed concretely (not generic over its return
 * type): oRPC's `os.middleware()` infers the downstream context shape from
 * this callback's literal return type, and a generic here collapses that
 * inference so `context.workspace` disappears in every router.
 */
function createAccessMiddleware(
  resolve: (input: AccessInput) => Promise<WorkspaceAccess>,
  mapCode: (code: WorkspaceAccessError["code"]) => AccessErrorKey,
) {
  return os.middleware(async ({ context, next, errors }) => {
    try {
      const access = await resolve({
        database: context.database,
        env: context.env,
        headers: context.headers,
        method: context.method,
        executionContext: context.executionContext,
      });
      return next({ context: access });
    } catch (error) {
      if (!(error instanceof WorkspaceAccessError)) throw error;
      const accessErrors = errors as unknown as Record<AccessErrorKey, () => Error>;
      throw accessErrors[mapCode(error.code)]();
    }
  });
}

const requireWorkspace = createAccessMiddleware(resolveWorkspaceAccess, (code) => {
  switch (code) {
    case "invalid_api_key":
      return "INVALID_API_KEY";
    case "origin_mismatch":
      return "ORIGIN_MISMATCH";
    case "workspace_required":
      return "WORKSPACE_REQUIRED";
    case "unauthorized":
      return "UNAUTHORIZED";
  }
});

export const authed = os.use(requireWorkspace);

const requireSessionWorkspace = createAccessMiddleware(resolveSessionWorkspaceAccess, (code) => {
  switch (code) {
    case "origin_mismatch":
      return "ORIGIN_MISMATCH";
    case "workspace_required":
      return "WORKSPACE_REQUIRED";
    case "unauthorized":
    case "invalid_api_key":
      return "UNAUTHORIZED";
  }
});

export const sessionAuthed = os.use(requireSessionWorkspace);

const requireSession = os.middleware(async ({ context, next, errors }) => {
  try {
    const access = await resolveSessionAccess({
      env: context.env,
      headers: context.headers,
      method: context.method,
    });
    return next({ context: access });
  } catch (error) {
    if (!(error instanceof WorkspaceAccessError)) throw error;
    if (error.code === "origin_mismatch") throw errors.ORIGIN_MISMATCH();
    throw errors.UNAUTHORIZED();
  }
});

export const sessionOnly = os.use(requireSession);

/**
 * Shared role guard for oRPC handlers. Every role-gated contract declares a
 * FORBIDDEN error; pass its constructor so the thrown error stays typed.
 */
export function requireRole(
  role: WorkspaceRole,
  minimum: WorkspaceRole,
  forbidden: () => Error,
): void {
  if (!hasWorkspaceRole(role, minimum)) throw forbidden();
}
