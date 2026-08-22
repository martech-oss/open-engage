import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import {
  WORKSPACE_ROLES,
  type WorkspaceContext,
  type WorkspaceRole,
} from "@openengage/core/shared";

import { member, organization } from "../auth/schema";
import type { OpenEngageDatabase } from "../client";
import { DatabaseRepository } from "../shared/repository-base";
import { apiKeys } from "./schema";

export async function resolveMemberContext(
  database: OpenEngageDatabase,
  userId: string,
  requestedOrganizationId: string | null,
): Promise<WorkspaceContext | null> {
  const conditions = [eq(member.userId, userId)];
  if (requestedOrganizationId) {
    conditions.push(eq(member.organizationId, requestedOrganizationId));
  }
  const [row] = await database.orm
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(and(...conditions))
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (!row || !isWorkspaceRole(row.role)) return null;
  return { workspaceId: row.organizationId, userId, role: row.role };
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export interface ApiKeyAuthRow {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  role: WorkspaceRole;
  keyHash: string;
}

/** Repository for the api_keys table: auth-boundary lookups and admin CRUD. */
export class ApiKeyRepository extends DatabaseRepository {
  public async findActiveByPrefix(prefix: string, now: string): Promise<ApiKeyAuthRow | null> {
    const [row] = await this.database.orm
      .select({
        id: apiKeys.id,
        workspaceId: apiKeys.workspaceId,
        createdByUserId: apiKeys.createdByUserId,
        role: apiKeys.role,
        keyHash: apiKeys.keyHash,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.prefix, prefix),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
        ),
      )
      .limit(1);
    return row && isWorkspaceRole(row.role) ? { ...row, role: row.role } : null;
  }

  public async touchLastUsed(apiKeyId: string, now: string): Promise<void> {
    await this.database.orm
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, apiKeyId));
  }

  public async create(input: {
    id: string;
    workspaceId: string;
    createdByUserId: string;
    name: string;
    prefix: string;
    keyHash: string;
    role: WorkspaceRole;
    expiresAt: string | null;
    createdAt: string;
  }): Promise<void> {
    await this.database.orm.insert(apiKeys).values(input);
  }
}

export class OrganizationRepository extends DatabaseRepository {
  public async isSlugAvailable(slug: string): Promise<boolean> {
    const rows = await this.database.orm
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1);
    return rows.length === 0;
  }
}
