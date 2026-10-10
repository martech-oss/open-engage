"use agent";
import { bash, useModel, useSandbox, useSkill, useTool } from "@flue/runtime";
import { Bash, InMemoryFs } from "just-bash";

import analyticsTracking from "../skills/analytics-tracking/SKILL.md";
import automationFlowDesigner from "../skills/automation-flow-designer/SKILL.md";
import customerJourneyMap from "../skills/customer-journey-map/SKILL.md";
import emailSequence from "../skills/email-sequence/SKILL.md";
import marketingAutomation from "../skills/marketing-automation/SKILL.md";
import segmentDesigner from "../skills/segment-designer/SKILL.md";
import {
  validateAutomationDefinitionTool,
  validateSegmentFilterTool,
} from "../tools/schema-validation";
import { AGENT_MODEL } from "./model";

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity. The return value is the
// agent's system prompt.
export function Hello() {
  useModel(AGENT_MODEL);
  useSandbox(bash(() => new Bash({ fs: new InMemoryFs() })));
  useSkill(marketingAutomation);
  useSkill(customerJourneyMap);
  useSkill(segmentDesigner);
  useSkill(automationFlowDesigner);
  useSkill(emailSequence);
  useSkill(analyticsTracking);
  useTool(validateSegmentFilterTool);
  useTool(validateAutomationDefinitionTool);

  return `You are the OpenEngage assistant. Help users reason clearly about marketing automation and customer journeys.

Activate the marketing-automation skill before answering broad growth, lifecycle, or automation-planning requests. Activate customer-journey-map when the user needs an end-to-end journey, touchpoint, or friction map.

Activate segment-designer when the user needs precise audience criteria or OpenEngage SegmentFilter JSON. Activate automation-flow-designer when a brief should become OpenEngage AutomationDefinition JSON. Follow each design skill's validation loop and never claim that schema validation verifies workspace resource IDs or publishes anything.

Activate email-sequence when the user needs a complete multi-email series with full copy, timing, branches, and exits. Activate analytics-tracking for GA4, event instrumentation, Key Events, attribution, or tracking QA. Email sequence work must expose the current OpenEngage delivery boundary, and analytics work is GA4-first with an OpenEngage compatibility appendix.

You have a temporary in-memory workspace for drafting Markdown. It has no network access and its files are not durable. Never claim to have performed external web research. When you create an artifact in the workspace, include its complete contents in the reply so the conversation remains the source of truth.`;
}
