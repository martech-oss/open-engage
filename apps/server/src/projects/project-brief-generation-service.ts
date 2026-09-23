import {
  marketingAutomationDesignerAgent,
  validateMarketingBriefGenerationResult,
} from "@openengage/core/agents";
import type {
  GenerateMarketingBriefInput,
  MarketingBriefGenerationResult,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { AiGenerationError } from "../agents/generation-error";
import { loadMarketingCapabilitySnapshot } from "../agents/marketing-context";
import { requestAgentProposal } from "../agents/proposal-client";
import { loadAutomationResourceContext } from "../automations/resource-validation";
import type { RuntimeEnv } from "../env";
import { loadSegmentCatalog } from "../segments/validation-service";

export async function generateMarketingBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateMarketingBriefInput,
): Promise<MarketingBriefGenerationResult> {
  const [resources, segmentCatalog] = await Promise.all([
    loadAutomationResourceContext(database, workspace),
    loadSegmentCatalog(database, workspace),
  ]);
  const result = await requestAgentProposal({
    env,
    agent: marketingAutomationDesignerAgent,
    prompt: input.prompt,
    initialData: {
      request: input,
      now: new Date().toISOString(),
      catalog: resources.catalog,
      segmentCatalog,
      capabilities: loadMarketingCapabilitySnapshot(),
    },
  });
  const issues = validateMarketingBriefGenerationResult(result, input, segmentCatalog);
  if (issues.length > 0) {
    throw new AiGenerationError("failed", {
      cause: new Error(issues.join("; ")),
    });
  }
  return result;
}
