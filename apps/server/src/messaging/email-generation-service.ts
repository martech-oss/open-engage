import { type AgentInitialData, emailDesignerAgent } from "@openengage/core/agents";
import {
  type EmailGenerationResult,
  type GenerateEmailInput,
  validateEmailGenerationResult,
} from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { EmailDesignRepository, MessagingRepository } from "@openengage/database/messaging";

import { AiGenerationError } from "../agents/generation-error";
import { loadMarketingCapabilitySnapshot } from "../agents/marketing-context";
import { requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";

export async function generateEmail(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateEmailInput,
): Promise<EmailGenerationResult> {
  const designRepository = new EmailDesignRepository(database, workspace);
  const [brand, publicImages, variables] = await Promise.all([
    designRepository.getBrandProfile(),
    designRepository.listAiImageCatalog(),
    new MessagingRepository(database, workspace).listMessageVariables(false),
  ]);
  const proposal = await requestEmailProposal(env, {
    request: input,
    capabilities: loadMarketingCapabilitySnapshot(),
    brand,
    variables: variables.map(({ key, name, description }) => ({ key, name, description })),
    publicImages,
  });
  const issue = validateEmailGenerationResult(proposal, { publicImages });
  if (issue) throw new AiGenerationError("failed", { cause: new Error(issue) });
  return proposal;
}

async function requestEmailProposal(
  env: RuntimeEnv,
  initialData: AgentInitialData<typeof emailDesignerAgent>,
): Promise<EmailGenerationResult> {
  return await requestAgentProposal({
    env,
    agent: emailDesignerAgent,
    prompt: initialData.request.prompt,
    initialData,
  });
}
