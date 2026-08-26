import { agentConversationsContract } from "./agents/contract";
import { appContract } from "./app/contract";
import { assetsContract } from "./assets/contract";
import { automationsContract } from "./automations/contract";
import { consentContract } from "./consent/contract";
import { companiesContract } from "./contacts/company-contract";
import { contactsContract } from "./contacts/contract";
import { contactResourcesContract } from "./contacts/resource-contract";
import { dealsContract } from "./deals/contract";
import { emailsContract } from "./messaging/contract";
import { contactDataContract, dashboardContract, platformContract } from "./operations/contract";
import { projectsContract } from "./projects/contract";
import { reportsContract } from "./reports/contract";
import { scoringContract } from "./scoring/contract";
import { segmentsContract } from "./segments/contract";
import { websiteContract } from "./web/contract";
import { workspaceContract } from "./workspaces/contract";

export const contract = {
  agents: { conversations: agentConversationsContract },
  app: appContract,
  companies: companiesContract,
  assets: assetsContract,
  workspace: workspaceContract,
  consent: consentContract,
  contacts: { ...contactsContract, ...contactResourcesContract, ...contactDataContract },
  automations: automationsContract,
  deals: dealsContract,
  emails: emailsContract,
  dashboard: dashboardContract,
  platform: platformContract,
  projects: projectsContract,
  reports: reportsContract,
  segments: segmentsContract,
  scoring: scoringContract,
  website: websiteContract,
};
