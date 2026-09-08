import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { VariableSettings } from "@/features/projects/variable-settings";
import type { Workspace } from "@/lib/workspace";

import { ApiKeyPanel } from "./api-key-panel";
import { BrandPanel } from "./brand-panel";
import { OperationHealthPanel } from "./operation-health-panel";
import { useSettingsController } from "./settings-controller";
import { TwoFactorPanel } from "./two-factor-panel";
import { WorkspaceInfoPanel } from "./workspace-info-panel";

export { settingsPermissions } from "./permissions";

export function SettingsPage({ workspace }: { workspace: Workspace }): ReactNode {
  const controller = useSettingsController(workspace);

  return (
    <PageLayout title="設定">
      <VariableSettings />
      {controller.permissions.canEditWorkspace && <OperationHealthPanel />}
      <div className="grid gap-6 xl:grid-cols-2">
        <BrandPanel
          key={controller.brandProfile.updatedAt ?? "default-brand"}
          profile={controller.brandProfile}
          editable={controller.permissions.canEditWorkspace}
        />
        <TwoFactorPanel />
        <ApiKeyPanel canManage={controller.permissions.canManageApiKeys} />
        <WorkspaceInfoPanel workspace={workspace} />
      </div>
    </PageLayout>
  );
}
