import { authClient } from "@/auth-client";
import { slugify } from "@/lib/utils";

export type WorkspaceOption = {
  id: string;
  name: string;
  slug: string;
};

/**
 * Current workspace first, then other memberships. The trigger stays usable
 * even before the organization list has loaded.
 */
export function listedWorkspaces(
  current: WorkspaceOption,
  organizations: readonly WorkspaceOption[] | null | undefined,
): WorkspaceOption[] {
  const seen = new Set<string>([current.id]);
  const rest: WorkspaceOption[] = [];
  for (const organization of organizations ?? []) {
    if (seen.has(organization.id)) continue;
    seen.add(organization.id);
    rest.push({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    });
  }
  return [{ id: current.id, name: current.name, slug: current.slug }, ...rest];
}

export async function activateWorkspace(
  organizationId: string,
): Promise<{ error: string } | { ok: true }> {
  const result = await authClient.organization.setActive({ organizationId });
  if (result.error) {
    return { error: result.error.message ?? "切り替えできませんでした" };
  }
  return { ok: true };
}

export async function createAndActivateWorkspace(
  name: string,
): Promise<{ error: string } | { ok: true }> {
  const created = await authClient.organization.create({
    name,
    slug: slugify(name),
  });
  if (created.error) {
    return { error: created.error.message ?? "作成できませんでした" };
  }
  if (created.data?.id) {
    return activateWorkspace(created.data.id);
  }
  return { ok: true };
}

export async function reloadAfterWorkspaceChange(options: {
  queryClient: { clear: () => void };
  router: { invalidate: (opts?: { sync?: boolean }) => Promise<unknown> };
  navigate: (opts: { to: "/dashboard"; replace: true }) => unknown;
}): Promise<void> {
  options.queryClient.clear();
  await options.router.invalidate({ sync: true });
  await options.navigate({ to: "/dashboard", replace: true });
}
