import { asc, eq } from "drizzle-orm";

import type { WorkspaceRole } from "@openengage/core/shared";
import { workspaceRoleSchema } from "@openengage/core/shared";

import { member, organization } from "../auth/schema";
import { DatabaseRepository } from "../shared/repository-base";

export interface BootstrapWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  createdAt: Date;
  role: WorkspaceRole;
}

/** Session-scoped read model used to assemble the browser bootstrap payload. */
export class WorkspaceBootstrapQueryRepository extends DatabaseRepository {
  public async listForUser(userId: string): Promise<BootstrapWorkspaceRow[]> {
    const rows = await this.database.orm
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        timezone: organization.timezone,
        createdAt: organization.createdAt,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt), asc(member.id));

    return rows.flatMap((row) => {
      const role = workspaceRoleSchema.safeParse(row.role);
      return role.success ? [{ ...row, role: role.data }] : [];
    });
  }
}
