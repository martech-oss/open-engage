import { agentProcedures } from "../agents/router";
import { automationProcedures } from "../automations/router";
import { consentProcedures } from "../consent/router";
import { companyProcedures } from "../contacts/company-router";
import { contactResourceProcedures } from "../contacts/resource-router";
import { contactProcedures } from "../contacts/router";
import { dealProcedures } from "../deals/router";
import { messagingProcedures } from "../messaging/router";
import { platformProcedures } from "../platform/router";
import { dashboardProcedures, reportProcedures } from "../reports/router";
import { scoringProcedures } from "../scoring/router";
import { segmentProcedures } from "../segments/router";
import { assetProcedures } from "../web/asset-router";
import { projectProcedures } from "../web/project-router";
import { websiteProcedures } from "../web/router";
import { workspaceProcedures } from "../workspaces/router";
import { os } from "./base";

export type { OrpcContext, OrpcInitialContext } from "./context";

export const orpcRouter = os.router({
  agents: agentProcedures,
  assets: assetProcedures,
  automations: automationProcedures,
  companies: companyProcedures,
  consent: consentProcedures,
  contacts: { ...contactProcedures, ...contactResourceProcedures },
  dashboard: dashboardProcedures,
  deals: dealProcedures,
  emails: messagingProcedures,
  platform: platformProcedures,
  projects: projectProcedures,
  reports: reportProcedures,
  segments: segmentProcedures,
  scoring: scoringProcedures,
  website: websiteProcedures,
  workspace: workspaceProcedures,
});
