import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";

import {
  automationDesignerAgent,
  companyEnrichmentAgent,
  emailDesignerAgent,
  emailSequenceDesignerAgent,
  landingPageDesignerAgent,
  marketingAutomationDesignerAgent,
  segmentDesignerAgent,
} from "@openengage/core/agents";

import { AutomationDesigner } from "./agents/automation-designer.ts";
import { CompanyEnrichment } from "./agents/company-enrichment.ts";
import { EmailDesigner } from "./agents/email-designer.ts";
import { EmailSequenceDesigner } from "./agents/email-sequence-designer.ts";
import { Hello } from "./agents/hello.ts";
import { LandingPageDesigner } from "./agents/landing-page-designer.ts";
import { MarketingAutomationDesigner } from "./agents/marketing-automation-designer.ts";
import { SegmentDesigner } from "./agents/segment-designer.ts";

const app = new Hono();

// The route map: every agent, channel, and custom route is mounted here
// explicitly. Talk to Hello with one POST per message:
//
//   curl -X POST http://localhost:3583/api/agents/hello/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"Tell me a joke."}'
app.route("/api/agents/hello", createAgentRouter(Hello));
app.route(`/internal/${automationDesignerAgent.name}`, createAgentRouter(AutomationDesigner));
app.route(`/internal/${companyEnrichmentAgent.name}`, createAgentRouter(CompanyEnrichment));
app.route(`/internal/${emailDesignerAgent.name}`, createAgentRouter(EmailDesigner));
app.route(`/internal/${emailSequenceDesignerAgent.name}`, createAgentRouter(EmailSequenceDesigner));
app.route(
  `/internal/${marketingAutomationDesignerAgent.name}`,
  createAgentRouter(MarketingAutomationDesigner),
);
app.route(`/internal/${segmentDesignerAgent.name}`, createAgentRouter(SegmentDesigner));
app.route(`/internal/${landingPageDesignerAgent.name}`, createAgentRouter(LandingPageDesigner));

export default app;
