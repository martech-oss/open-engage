import { isAPIError } from "better-auth/api";

import type { EmailBrandProfileWrite } from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { Workspace } from "@openengage/core/workspaces";
import { capabilitiesForRole } from "@openengage/core/workspaces";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { EmailDesignRepository } from "@openengage/database/messaging";
import {
  OrganizationRepository,
  WorkspaceSettingsRepository,
} from "@openengage/database/workspaces";

import { createAuth } from "../auth/service";
import type { RuntimeEnv } from "../env";
import { availableSlug } from "./slug-service";

export async function createWorkspace(
  database: OpenEngageDatabase,
  env: RuntimeEnv,
  headers: Headers,
  name: string,
): Promise<{ id: string; name: string; slug: string }> {
  const repository = new OrganizationRepository(database);
  const auth = createAuth(env);
  const created = await createWorkspaceOrganizationWithRetry({
    nextSlug: () =>
      availableSlug(name, "workspace", (candidate) => repository.isSlugAvailable(candidate)),
    createOrganization: (slug) => auth.api.createOrganization({ body: { name, slug }, headers }),
  });
  return { id: created.id, name: created.name, slug: created.slug };
}

export async function createWorkspaceOrganizationWithRetry<T>(input: {
  nextSlug: () => Promise<string>;
  createOrganization: (slug: string) => Promise<T>;
}): Promise<T> {
  for (;;) {
    const slug = await input.nextSlug();
    try {
      return await input.createOrganization(slug);
    } catch (error) {
      if (!isOrganizationExistsCollision(error)) throw error;
    }
  }
}

function isOrganizationExistsCollision(error: unknown): boolean {
  return (
    isAPIError(error) &&
    error.statusCode === 400 &&
    error.body?.code === "ORGANIZATION_ALREADY_EXISTS"
  );
}

export async function getWorkspace(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<Workspace> {
  const row = await new WorkspaceSettingsRepository(database, workspace).getWorkspace();

  if (!row) {
    throw new Error("Workspace organization could not be loaded");
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    timezone: row.timezone,
    created_at: row.createdAt.getTime(),
    role: workspace.role,
    capabilities: capabilitiesForRole(workspace.role),
  };
}

export function getEmailBrandProfile(database: OpenEngageDatabase, workspace: WorkspaceContext) {
  return new EmailDesignRepository(database, workspace).getBrandProfile();
}

export async function updateEmailBrandProfile(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: EmailBrandProfileWrite,
): Promise<
  | { kind: "invalid_logo" }
  | { kind: "ok"; profile: Awaited<ReturnType<EmailDesignRepository["getBrandProfile"]>> }
> {
  const repository = new EmailDesignRepository(database, workspace);
  if (input.logoAssetId) {
    const valid = await repository.validatePublicImageAssets([input.logoAssetId]);
    if (!valid.has(input.logoAssetId)) return { kind: "invalid_logo" };
  }
  const profile = await repository.upsertBrandProfile(input);
  return { kind: "ok", profile };
}
