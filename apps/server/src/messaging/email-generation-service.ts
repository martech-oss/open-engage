import {
  emailGenerationResultSchema,
  type EmailBlockV2,
  type EmailDocumentV2,
  type EmailGenerationResult,
  type GenerateEmailInput,
} from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  EmailDesignRepository,
  MessagingRepository,
  type OpenEngageDatabase,
} from "@openengage/database";

import { loadMarketingCapabilitySnapshot } from "../agents/marketing-context";
import { AgentProposalError, requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";

const GENERATION_TIMEOUT_MS = 60_000;

export type EmailGenerationFailure = "failed" | "timeout" | "unavailable";

export class EmailGenerationError extends Error {
  public constructor(
    public readonly kind: EmailGenerationFailure,
    options?: ErrorOptions,
  ) {
    super(`Email generation ${kind}`, options);
    this.name = "EmailGenerationError";
  }
}

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
  initialData: {
    request: GenerateEmailInput;
    capabilities: ReturnType<typeof loadMarketingCapabilitySnapshot>;
    brand: Awaited<ReturnType<EmailDesignRepository["getBrandProfile"]>>;
    variables: Array<{ key: string; name: string; description: string }>;
    publicImages: Awaited<ReturnType<EmailDesignRepository["listAiImageCatalog"]>>;
  },
): Promise<EmailGenerationResult> {
  try {
    return await requestAgentProposal({
      env,
      agent: "email-designer",
      prompt: initialData.request.prompt,
      initialData,
      schema: emailGenerationResultSchema,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof AgentProposalError) {
      throw new EmailGenerationError(error.kind, { cause: error });
    }
    throw error;
  }
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
  throw new EmailGenerationError("failed", { cause: new Error(message) });
}
