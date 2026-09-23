import { type AgentInitialData, emailDesignerAgent } from "@openengage/core/agents";
import {
  type EmailBlockV2,
  type EmailDocumentV2,
  type EmailGenerationResult,
  type GenerateEmailInput,
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
  validateGeneratedDocument(proposal.proposal.content, new Set(publicImages.map(({ id }) => id)));
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

function validateGeneratedDocument(
  document: EmailDocumentV2,
  allowedAssets: ReadonlySet<string>,
): void {
  const ids = new Set<string>();
  for (const block of document.blocks) {
    if (ids.has(block.id)) fail(`Duplicate block id: ${block.id}`);
    ids.add(block.id);
    const children =
      block.type === "columns"
        ? block.columns.flatMap((column) => column.blocks)
        : block.type === "conditional"
          ? block.blocks
          : [];
    validateImage(block, allowedAssets);
    for (const child of children) {
      if (ids.has(child.id)) fail(`Duplicate block id: ${child.id}`);
      ids.add(child.id);
      validateImage(child, allowedAssets);
    }
  }
}

function validateImage(block: EmailBlockV2, allowedAssets: ReadonlySet<string>): void {
  if (!isImageBlock(block)) return;
  if (!allowedAssets.has(block.source.assetId))
    fail(`Unknown image asset: ${block.source.assetId}`);
}

function isImageBlock(value: unknown): value is Extract<EmailBlockV2, { type: "image" }> {
  return typeof value === "object" && value !== null && "type" in value && value.type === "image";
}

function fail(message: string): never {
  throw new AiGenerationError("failed", { cause: new Error(message) });
}
