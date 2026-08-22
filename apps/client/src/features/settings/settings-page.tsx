import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { emailBrandProfileQueryOptions } from "@/features/emails/email-api";
import type { Workspace } from "@/lib/workspace";

import { ApiKeyPanel } from "./api-key-panel";
import { BrandPanel } from "./brand-panel";
import { settingsPermissions } from "./permissions";
import { TwoFactorPanel } from "./two-factor-panel";
import { WorkspaceInfoPanel } from "./workspace-info-panel";

export { settingsPermissions } from "./permissions";

export function SettingsPage({ workspace }: { workspace: Workspace }): ReactNode {
  const { data: brandProfile } = useSuspenseQuery(emailBrandProfileQueryOptions());
  const permissions = settingsPermissions(workspace.capabilities);

  return (
    <PageLayout title="設定">
      <div className="grid gap-6 xl:grid-cols-2">
        <BrandPanel
          key={brandProfile.updatedAt ?? "default-brand"}
          profile={brandProfile}
          editable={permissions.canEditWorkspace}
        />
        <TwoFactorPanel />
        <ApiKeyPanel canManage={permissions.canManageApiKeys} />
        <WorkspaceInfoPanel workspace={workspace} />
      </div>
    </PageLayout>
  );
}
