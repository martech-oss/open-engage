import type { Context } from "hono";

import {
  resolveAuthenticatedSession,
  resolveSessionAccess,
  resolveSessionWorkspaceAccess,
  resolveWorkspaceAccess,
} from "../auth/access";
import type { AccessResolutionObserver } from "../auth/access";
import type { AppEnvironment } from "../env";
import { createRequestAccessCache } from "./access-cache";
import type { OrpcInitialContext } from "./context";

/** Builds the oRPC request context shared by the RPC and OpenAPI handlers. */
export function orpcRequestContext(
  context: Context<AppEnvironment>,
  onAccessResolution?: AccessResolutionObserver,
): OrpcInitialContext {
  const accessInput = {
    database: context.get("database"),
    env: context.env,
    headers: context.req.raw.headers,
    method: context.req.method,
    executionContext: context.executionCtx,
  };
  let authenticatedSession: ReturnType<typeof resolveAuthenticatedSession> | undefined;
  const getSession = () =>
    (authenticatedSession ??= resolveAuthenticatedSession({
      env: accessInput.env,
      headers: accessInput.headers,
      onResolution: onAccessResolution,
    }));
  let resolvedSessionWorkspace: ReturnType<typeof resolveSessionWorkspaceAccess> | undefined;
  const getSessionWorkspace = () =>
    (resolvedSessionWorkspace ??= resolveSessionWorkspaceAccess({
      ...accessInput,
      onResolution: onAccessResolution,
      getSession,
    }));
  const usesApiKey = accessInput.headers.get("authorization")?.startsWith("Bearer ") ?? false;
  return {
    database: accessInput.database,
    requestId: context.get("requestId"),
    env: accessInput.env,
    headers: accessInput.headers,
    method: accessInput.method,
    executionContext: accessInput.executionContext,
    access: createRequestAccessCache({
      workspace: () =>
        usesApiKey
          ? resolveWorkspaceAccess({
              ...accessInput,
              onResolution: onAccessResolution,
              getSession,
            })
          : getSessionWorkspace(),
      sessionWorkspace: getSessionWorkspace,
      session: () =>
        resolveSessionAccess({
          env: accessInput.env,
          headers: accessInput.headers,
          method: accessInput.method,
          requireMutationOrigin: true,
          onResolution: onAccessResolution,
          getSession,
        }),
    }),
  };
}
