import { useSuspenseQuery } from "@tanstack/react-query";

import { emailBrandProfileQueryOptions } from "@/features/emails/email-api";
import type { Workspace } from "@/lib/workspace";

import { settingsPermissions } from "./permissions";

export function useSettingsController(workspace: Workspace) {
  const { data: brandProfile } = useSuspenseQuery(emailBrandProfileQueryOptions());
  return {
    brandProfile,
    permissions: settingsPermissions(workspace.capabilities),
  };
}
