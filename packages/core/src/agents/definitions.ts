import type * as z from "zod";

import {
  emailSequenceAgentResultSchema,
  emailSequenceDesignerInitialDataSchema,
} from "../automations/email-sequence.js";
import {
  automationDesignerInitialDataSchema,
  automationGenerationAgentResultSchema,
} from "../automations/generation.js";
import {
  companyEnrichmentAgentInitialDataSchema,
  companyEnrichmentResultSchema,
} from "../contacts/company-enrichment.js";
import {
  emailGenerationAgentInitialDataSchema,
  emailGenerationResultSchema,
} from "../messaging/generation.js";
import { marketingBriefGenerationResultSchema } from "../projects/generation.js";
import {
  segmentDesignerInitialDataSchema,
  segmentGenerationAgentResultSchema,
} from "../segments/generation.js";
import { landingGenerationResultSchema } from "../web/landing-document.js";
import { landingPageDesignerInitialDataSchema } from "./landing-page.js";
import { marketingBriefDesignerInitialDataSchema } from "./marketing-automation.js";

// The Server outwaits the Agent's durability deadline so an Agent timeout
// settles as a durable submission failure before the Server gives up.
const SERVER_TIMEOUT_MARGIN_MS = 5_000;

/** The contract of one Server-to-Agent proposal call, shared by both Workers. */
export interface AgentDefinition<
  InitialData extends z.ZodType = z.ZodType,
  Result extends z.ZodType = z.ZodType,
> {
  /** Route segment under the Agent Worker's /internal/ namespace. */
  readonly name: string;
  readonly initialData: InitialData;
  readonly result: Result;
  readonly agentTimeoutMs: number;
  readonly serverTimeoutMs: number;
}

/** The trusted data a caller sends when it starts an Agent conversation. */
export type AgentInitialData<Definition extends AgentDefinition> = z.input<
  Definition["initialData"]
>;
/** The parsed proposal an Agent submits. */
export type AgentResult<Definition extends AgentDefinition> = z.output<Definition["result"]>;

function defineAgent<InitialData extends z.ZodType, Result extends z.ZodType>(
  definition: Omit<AgentDefinition<InitialData, Result>, "serverTimeoutMs">,
): AgentDefinition<InitialData, Result> {
  return {
    ...definition,
    serverTimeoutMs: definition.agentTimeoutMs + SERVER_TIMEOUT_MARGIN_MS,
  };
}

export const automationDesignerAgent = defineAgent({
  name: "automation-designer",
  initialData: automationDesignerInitialDataSchema,
  result: automationGenerationAgentResultSchema,
  agentTimeoutMs: 55_000,
});

export const companyEnrichmentAgent = defineAgent({
  name: "company-enrichment",
  initialData: companyEnrichmentAgentInitialDataSchema,
  result: companyEnrichmentResultSchema,
  agentTimeoutMs: 85_000,
});

export const emailDesignerAgent = defineAgent({
  name: "email-designer",
  initialData: emailGenerationAgentInitialDataSchema,
  result: emailGenerationResultSchema,
  agentTimeoutMs: 55_000,
});

export const emailSequenceDesignerAgent = defineAgent({
  name: "email-sequence-designer",
  initialData: emailSequenceDesignerInitialDataSchema,
  result: emailSequenceAgentResultSchema,
  agentTimeoutMs: 85_000,
});

export const landingPageDesignerAgent = defineAgent({
  name: "landing-page-designer",
  initialData: landingPageDesignerInitialDataSchema,
  result: landingGenerationResultSchema,
  agentTimeoutMs: 55_000,
});

export const marketingAutomationDesignerAgent = defineAgent({
  name: "marketing-automation-designer",
  initialData: marketingBriefDesignerInitialDataSchema,
  result: marketingBriefGenerationResultSchema,
  agentTimeoutMs: 55_000,
});

export const segmentDesignerAgent = defineAgent({
  name: "segment-designer",
  initialData: segmentDesignerInitialDataSchema,
  result: segmentGenerationAgentResultSchema,
  agentTimeoutMs: 55_000,
});
