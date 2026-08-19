import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { makeSignature } from "better-auth/crypto";
import { exports } from "cloudflare:workers";

import {
  apiKeys,
  createDatabase,
  member,
  organization,
  session,
  user,
  uuidv7,
} from "@openengage/database/testing";
import { contract, type WorkspaceContext, type WorkspaceRole } from "@openengage/orpc";

import { randomIdentifier, sha256Hex } from "../src/platform/crypto";

export interface WorkspaceFixture {
  workspaceId: string;
  userId: string;
  prefix: string;
  token: string;
  /** Organization slug, used by the public (unauthenticated) routes. */
  slug: string;
}

export interface SeedWorkspaceOptions {
  /** API key role; defaults to "owner". */
  role?: WorkspaceRole;
  /** Organization (workspace) name; defaults to "Test Workspace". */
  name?: string;
  /** Organization timezone; defaults to "UTC". */
  timezone?: string;
}

/**
 * Seeds a workspace — user, organization and API key — through the Drizzle
 * client and returns the pieces tests need to talk to it. The returned token
 * authenticates at `options.role` via the regular Bearer header.
 */
export async function seedWorkspace(
  db: D1Database,
  options: SeedWorkspaceOptions = {},
): Promise<WorkspaceFixture> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const prefix = randomIdentifier(12);
  const token = `openengage_${prefix}_abcdefghijklmnopqrstuvwx`;
  const slug = `ws-${workspaceId}`;
  const now = new Date();
  const orm = createDatabase(db).orm;
  await orm.batch([
    orm.insert(user).values({
      id: userId,
      name: "Test Owner",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(organization).values({
      id: workspaceId,
      name: options.name ?? "Test Workspace",
      slug,
      createdAt: now,
      timezone: options.timezone ?? "UTC",
    }),
    orm.insert(apiKeys).values({
      id: uuidv7(),
      workspaceId,
      createdByUserId: userId,
      name: "test key",
      prefix,
      keyHash: await sha256Hex(token),
      role: options.role ?? "owner",
      createdAt: now.toISOString(),
    }),
  ]);
  return { workspaceId, userId, prefix, token, slug };
}

/** Adds the fixture user to the organization's member table (deal/report tests read it). */
export async function seedMember(
  db: D1Database,
  input: { workspaceId: string; userId: string; role?: WorkspaceRole },
): Promise<void> {
  await createDatabase(db)
    .orm.insert(member)
    .values({
      id: uuidv7(),
      organizationId: input.workspaceId,
      userId: input.userId,
      role: input.role ?? "owner",
      createdAt: new Date(),
    });
}

/**
 * Seeds a workspace, user and membership row, for tests that construct a
 * repository directly instead of going through an authenticated oRPC client.
 */
export async function seedWorkspaceContext(
  db: D1Database,
  label: string,
  role: WorkspaceRole = "owner",
): Promise<WorkspaceContext> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const now = new Date();
  await createDatabase(db).orm.batch([
    createDatabase(db)
      .orm.insert(user)
      .values({
        id: userId,
        name: `${label} User`,
        email: `${label}-${userId}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }),
    createDatabase(db)
      .orm.insert(organization)
      .values({
        id: workspaceId,
        name: `${label} Workspace`,
        slug: `${label}-${workspaceId}`,
        createdAt: now,
        timezone: "UTC",
      }),
  ]);
  await seedMember(db, { workspaceId, userId, role });
  return { workspaceId, userId, role };
}

/** Typed oRPC client for a seeded fixture, driven through the worker's fetch handler. */
export function createFixtureClient(fixture: {
  token: string;
}): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { authorization: `Bearer ${fixture.token}` },
    fetch: (request) => exports.default.fetch(request),
  });
  return createORPCClient(link);
}

export async function createSessionFixtureClient(
  db: D1Database,
  fixture: Pick<WorkspaceFixture, "workspaceId" | "userId">,
): Promise<{ cookie: string; client: ContractRouterClient<typeof contract> }> {
  const token = randomIdentifier(48);
  const now = new Date();
  await createDatabase(db)
    .orm.insert(session)
    .values({
      id: uuidv7(),
      token,
      userId: fixture.userId,
      activeOrganizationId: fixture.workspaceId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
  const signature = await makeSignature(token, "test-better-auth-secret-at-least-32-characters");
  const cookie = `__Secure-openengage.session_token=${token}.${signature}`;
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: { cookie },
    fetch: (request) => exports.default.fetch(request),
  });
  return { cookie, client: createORPCClient(link) };
}

/** Convenience: seed a workspace and return the fixture together with a typed client. */
export async function seedWorkspaceClient(
  db: D1Database,
  options: SeedWorkspaceOptions = {},
): Promise<WorkspaceFixture & { client: ContractRouterClient<typeof contract> }> {
  const fixture = await seedWorkspace(db, options);
  return { ...fixture, client: createFixtureClient(fixture) };
}
