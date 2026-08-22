import { createMiddleware } from "hono/factory";

import type { WorkspaceContext } from "@openengage/core/shared";
import { createDatabase } from "@openengage/database/client";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { ApiKeyRepository, resolveMemberContext } from "@openengage/database/workspaces";
import { workspaceErrors } from "@openengage/orpc";

import type { AppEnvironment, SessionValue } from "../env";
import { sha256Hex } from "../platform/crypto";
import { timingSafeEqual } from "../platform/signatures";
import { createAuth } from "./service";

interface BackgroundContext {
  waitUntil(promise: Promise<unknown>): void;
}

type WorkspaceAccessErrorCode =
  | "invalid_api_key"
  | "unauthorized"
  | "origin_mismatch"
  | "workspace_required";

export class WorkspaceAccessError extends Error {
  public constructor(
    public readonly status: 401 | 403,
    public readonly code: WorkspaceAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export interface WorkspaceAccess {
  workspace: WorkspaceContext;
  session: SessionValue | null;
}

export interface SessionAccess {
  session: SessionValue;
}

export const requestContext = createMiddleware<AppEnvironment>(async (context, next) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  context.set("database", createDatabase(context.env.DB));
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-Id", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!context.res.headers.has("Content-Security-Policy")) {
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  }
});

export async function resolveWorkspaceAccess({
  database,
  env,
  headers,
  method,
  executionContext,
}: {
  database: OpenEngageDatabase;
  env: AppEnvironment["Bindings"];
  headers: Headers;
  method: string;
  executionContext: BackgroundContext;
}): Promise<WorkspaceAccess> {
  const bearer = headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const apiContext = await resolveApiKey(database, bearer.slice(7));
    if (!apiContext) {
      throw new WorkspaceAccessError(
        401,
        "invalid_api_key",
        workspaceErrors.INVALID_API_KEY.message,
      );
    }
    executionContext.waitUntil(
      new ApiKeyRepository(database).touchLastUsed(apiContext.apiKeyId, new Date().toISOString()),
    );
    return { workspace: apiContext, session: null };
  }

  return resolveSessionWorkspaceAccess({ database, env, headers, method });
}

export async function resolveSessionWorkspaceAccess({
  database,
  env,
  headers,
  method,
}: {
  database: OpenEngageDatabase;
  env: AppEnvironment["Bindings"];
  headers: Headers;
  method: string;
}): Promise<WorkspaceAccess & { session: SessionValue }> {
  const { session } = await resolveSessionAccess({ env, headers, method });

  const requestedOrganizationId =
    headers.get("x-openengage-workspace") ?? session.session.activeOrganizationId ?? null;
  const workspace = await resolveMemberContext(database, session.user.id, requestedOrganizationId);
  if (!workspace) {
    throw new WorkspaceAccessError(
      403,
      "workspace_required",
      workspaceErrors.WORKSPACE_REQUIRED.message,
    );
  }
  return { workspace, session };
}

export async function resolveSessionAccess({
  env,
  headers,
  method,
  requireMutationOrigin = false,
}: {
  env: AppEnvironment["Bindings"];
  headers: Headers;
  method: string;
  requireMutationOrigin?: boolean;
}): Promise<SessionAccess> {
  const auth = createAuth(env);
  const session = (await auth.api.getSession({ headers })) as SessionValue | null;
  if (!session) {
    throw new WorkspaceAccessError(401, "unauthorized", workspaceErrors.UNAUTHORIZED.message);
  }
  if (isMutation(method)) {
    const origin = headers.get("origin");
    const expectedOrigin = new URL(env.APP_URL).origin;
    if (
      (requireMutationOrigin && origin !== expectedOrigin) ||
      (!requireMutationOrigin && origin !== null && origin !== expectedOrigin)
    ) {
      throw new WorkspaceAccessError(
        403,
        "origin_mismatch",
        workspaceErrors.ORIGIN_MISMATCH.message,
      );
    }
  }
  return { session };
}

export function apiError(
  context: {
    get(key: "requestId"): string;
    json: (
      body: unknown,
      status: 400 | 401 | 403 | 404 | 409 | 411 | 413 | 415 | 422 | 429 | 500 | 503,
    ) => Response;
  },
  status: 400 | 401 | 403 | 404 | 409 | 411 | 413 | 415 | 422 | 429 | 500 | 503,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return context.json(
    {
      error: {
        code,
        message,
        requestId: context.get("requestId"),
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  );
}

async function resolveApiKey(database: OpenEngageDatabase, token: string) {
  const match = token.match(/^openengage_([A-Za-z0-9]{12})_([A-Za-z0-9-]{20,})$/);
  if (!match) return null;
  const prefix = match[1];
  if (!prefix) return null;
  const row = await new ApiKeyRepository(database).findActiveByPrefix(
    prefix,
    new Date().toISOString(),
  );
  if (!row) return null;
  const hash = await sha256Hex(token);
  if (!timingSafeEqual(hash, row.keyHash)) return null;
  return {
    workspaceId: row.workspaceId,
    userId: row.createdByUserId,
    role: row.role,
    apiKeyId: row.id,
  };
}

function isMutation(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}
