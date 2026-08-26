import { capabilitiesForRole } from "@openengage/core/workspaces";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { WorkspaceBootstrapQueryRepository } from "@openengage/database/workspaces";
import type { AppBootstrap } from "@openengage/orpc";

import type { SessionValue } from "../env";

export async function getAppBootstrap(
  database: OpenEngageDatabase,
  session: SessionValue,
): Promise<AppBootstrap> {
  const rows = await new WorkspaceBootstrapQueryRepository(database).listForUser(session.user.id);
  const selected = session.session.activeOrganizationId
    ? rows.find((row) => row.id === session.session.activeOrganizationId)
    : rows[0];

  return {
    viewer: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    workspace: selected
      ? {
          id: selected.id,
          name: selected.name,
          slug: selected.slug,
          logo: selected.logo,
          timezone: selected.timezone,
          created_at: selected.createdAt.getTime(),
          role: selected.role,
          capabilities: capabilitiesForRole(selected.role),
        }
      : null,
    workspaces: rows.map(({ id, name, slug }) => ({ id, name, slug })),
  };
}
