import type { WorkspaceContext } from "@openengage/core/shared";
import { landingGenerationResultSchema } from "@openengage/core/web";
import { createDatabase, type OpenEngageDatabase } from "@openengage/database/client";
import { EmailDesignRepository } from "@openengage/database/messaging";
import { isConstraintError } from "@openengage/database/shared";
import {
  LandingDesignRepository,
  LandingGenerationRepository,
  SignupFormRepository,
} from "@openengage/database/web";

import { requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";
import { generateEmailImage } from "../messaging/email-image-generation-service";
import { logError } from "../observability";
import { resolveProjectVariables } from "../projects/variable-service";
import { validateLandingReferences } from "./landing-reference-validation";
import { sanitizeLandingDocument } from "./landing-safety";

type LandingGenerationQueueOutcome =
  | { kind: "ok"; job: NonNullable<Awaited<ReturnType<LandingDesignRepository["queue"]>>> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid" };

export async function queueLandingGeneration(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: Omit<Parameters<LandingDesignRepository["queue"]>[0], "userId">,
): Promise<LandingGenerationQueueOutcome> {
  const repository = new LandingDesignRepository(database, workspace);
  const page = await repository.page(input.pageId);
  if (!page) return { kind: "not_found" };
  if (page.currentVersionId !== input.baseVersionId) return { kind: "conflict" };
  const job = await repository.queue({ ...input, userId: workspace.userId });
  if (!job) return { kind: "invalid" };
  if (job.prompt !== input.prompt || job.baseVersionId !== input.baseVersionId)
    return { kind: "conflict" };
  // A durable queued row is authoritative. Scheduled recovery covers queue publication failures.
  try {
    await env.JOBS_QUEUE.send({ kind: "landing_generation", jobId: job.id });
  } catch {
    /* recovered on the next scheduled run */
  }
  return { kind: "ok", job };
}

export async function retryLandingGeneration(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: { pageId: string; jobId: string },
): Promise<"ok" | "not_found" | "conflict"> {
  const repository = new LandingDesignRepository(database, workspace);
  if (!(await repository.page(input.pageId))) return "not_found";
  if (!(await repository.retryGeneration(input.pageId, input.jobId, workspace.userId)))
    return "conflict";
  try {
    await env.JOBS_QUEUE.send({ kind: "landing_generation", jobId: input.jobId });
  } catch {
    /* The persisted queued state is retried by scheduled recovery. */
  }
  return "ok";
}

export async function processLandingGeneration(
  jobId: string,
  env: RuntimeEnv,
  requestProposal?: (
    initialData: unknown,
  ) => Promise<ReturnType<typeof landingGenerationResultSchema.parse>>,
): Promise<void> {
  const database = createDatabase(env.DB),
    jobs = new LandingGenerationRepository(database);
  const job = await jobs.claim(jobId);
  if (!job?.leaseId) return;
  const workspace: WorkspaceContext = {
    workspaceId: job.workspaceId,
    userId: job.userId,
    role: "marketer",
  };
  let phase: "generation" | "validation" | "commit" = "generation";
  try {
    const repository = new LandingDesignRepository(database, workspace);
    const page = await repository.page(job.pageId),
      base = await repository.version(job.pageId, job.baseVersionId);
    if (!page || !base || page.currentVersionId !== job.baseVersionId) {
      await jobs.finish(jobId, job.leaseId, {
        status: "conflict",
        error: "下書きが更新されています。最新の版から再生成してください。",
      });
      return;
    }
    const brandRepository = new EmailDesignRepository(database, workspace);
    const [brand, publicImages, history, forms] = await Promise.all([
      brandRepository.getBrandProfile(),
      brandRepository.listAiImageCatalog(),
      repository.jobs(job.pageId),
      new SignupFormRepository(database, workspace).listSignupForms(),
    ]);
    const variables = await resolveProjectVariables(
      database,
      workspace.workspaceId,
      base.document.variableProjectId ?? null,
    );
    const initialData = {
      variables: variables.values.map(({ key, type, value }) => ({ key, type, value })),
      variableProjectId: base.document.variableProjectId ?? null,
      brand,
      publicImages,
      forms: forms.slice(0, 50).map((form) => ({
        id: form.id,
        name: form.name,
        definition: form.definition,
        turnstileEnabled: form.turnstileEnabled,
        successMessage: form.successMessage,
      })),
      document: base.document,
      request: job.prompt,
      history: history
        .filter((item) => item.status === "completed")
        .slice(0, 12)
        .reverse()
        .map((item) => ({ prompt: item.prompt, explanation: item.explanation })),
    };
    const proposal = landingGenerationResultSchema.parse(
      await (requestProposal
        ? requestProposal(initialData)
        : requestAgentProposal({
            env,
            agent: "landing-page-designer",
            prompt: job.prompt,
            initialData,
            schema: landingGenerationResultSchema,
            timeoutMs: 60_000,
          })),
    );
    for (const request of proposal.imageRequests) {
      const slot = proposal.document.images.find((image) => image.refId === request.refId);
      if (!slot) throw new Error("画像生成先が見つかりません");
      const image = await generateEmailImage(
        database,
        workspace,
        env,
        { requestId: `${jobId}-${request.refId}`, prompt: request.prompt, alt: request.alt },
        {
          waitUntil: (promise) => {
            void promise.catch((error) =>
              logError("landing.asset_background_failed", error, { jobId }),
            );
          },
        },
      );
      slot.assetId = image.assetId;
      slot.alt = image.alt;
    }
    phase = "validation";
    proposal.document.variableProjectId = base.document.variableProjectId ?? null;
    const document = await sanitizeLandingDocument(proposal.document);
    await validateLandingReferences(database, job.workspaceId, document, env);
    phase = "commit";
    const versionId = await repository.applyGeneration({
      jobId,
      leaseId: job.leaseId,
      pageId: page.id,
      baseVersionId: job.baseVersionId,
      document,
      explanation: proposal.explanation,
    });
    if (!versionId)
      await jobs.finish(jobId, job.leaseId, {
        status: "conflict",
        error: "下書きが更新されています。最新の版から再生成してください。",
      });
  } catch (error) {
    logError("landing.generation_failed", error, { jobId, workspaceId: job.workspaceId });
    const conflict = phase === "commit" && isConstraintError(error);
    await jobs.finish(jobId, job.leaseId, {
      status: conflict ? "conflict" : "failed",
      failureKind: conflict ? "conflict" : phase === "validation" ? "configuration" : "retryable",
      error: conflict
        ? "下書きが更新されています。最新の版から再生成してください。"
        : phase === "validation"
          ? "生成内容や参照を確認できませんでした。指示を修正して再生成してください。直前の下書きは保持されています。"
          : "生成できませんでした。直前の下書きは保持されています。再試行できます。",
    });
  }
}

export async function recoverLandingGenerations(env: RuntimeEnv) {
  const jobs = await new LandingGenerationRepository(createDatabase(env.DB)).pending();
  if (jobs.length)
    await env.JOBS_QUEUE.sendBatch(
      jobs.map((job) => ({ body: { kind: "landing_generation" as const, jobId: job.id } })),
    );
}
