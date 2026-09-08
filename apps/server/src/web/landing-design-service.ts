import type { ProgramBinding } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { landingGenerationResultSchema, type LandingPageDocument } from "@openengage/core/web";
import { AssetRepository } from "@openengage/database/assets";
import { createDatabase, type OpenEngageDatabase } from "@openengage/database/client";
import {
  EmailDesignRepository,
  GeneratedEmailImageRepository,
} from "@openengage/database/messaging";
import { FormProgramRepository } from "@openengage/database/projects";
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
import { hasTurnstileConfiguration } from "./config";
import { sanitizeLandingDocument } from "./landing-safety";
import { resolveLandingVariablePublication } from "./variable-publication-service";

export async function validateLandingReferences(
  database: OpenEngageDatabase,
  workspaceId: string,
  document: LandingPageDocument,
  env: RuntimeEnv,
  publishing = false,
): Promise<void> {
  const repository = new LandingDesignRepository(database, { workspaceId });
  if (document.variableProjectId && !(await repository.validProject(document.variableProjectId)))
    throw new Error("変数のProjectが見つかりません");
  if (
    document.measurement.projectId &&
    !(await repository.validProject(document.measurement.projectId))
  )
    throw new Error("キャンペーンが見つかりません");
  for (const form of document.forms) {
    if (form.formId && !(await repository.validForm(form.formId)))
      throw new Error("参照フォームが見つかりません");
    if (publishing && form.turnstileEnabled && !hasTurnstileConfiguration(env))
      throw new Error("Turnstileの設定が必要です");
  }
  const assets = new AssetRepository(database, { workspaceId });
  const generated = new GeneratedEmailImageRepository(database);
  for (const image of document.images) {
    const asset = await assets.getById(image.assetId);
    if (!asset || asset.archivedAt || asset.kind !== "image")
      throw new Error("画像が見つかりません");
    if (
      asset.visibility !== "public" &&
      !(await generated.getForPreview(workspaceId, image.assetId, new Date().toISOString()))
    )
      throw new Error("画像は公開アセットまたは生成画像を指定してください");
    if (publishing && !(await env.ASSETS_BUCKET.head(asset.r2Key)))
      throw new Error("画像ファイルの準備が完了していません");
  }
}

export async function publishLandingPage(
  database: OpenEngageDatabase,
  workspaceId: string,
  env: RuntimeEnv,
  input: { id: string; versionId: string; baseVersionId: string },
) {
  const repository = new LandingDesignRepository(database, { workspaceId });
  const page = await repository.page(input.id),
    version = await repository.version(input.id, input.versionId);
  if (!page || !version) return "not_found" as const;
  if (page.currentVersionId !== input.baseVersionId) return "conflict" as const;
  const { snapshot, formSnapshots, document } =
    version.publishedDocument && version.variableSnapshot
      ? {
          snapshot: version.variableSnapshot,
          formSnapshots: {},
          document: version.publishedDocument,
        }
      : await resolveLandingVariablePublication(database, workspaceId, version.document);
  await validateLandingReferences(database, workspaceId, document, env, true);
  const programBindings: Record<string, ProgramBinding | null> = {};
  if (!version.publishedAt) {
    const programs = new FormProgramRepository(database, { workspaceId });
    for (const form of version.document.forms) {
      const binding = form.formId ? await programs.get(form.formId) : null;
      programBindings[form.refId] = binding
        ? await programs.validate(binding, document.measurement.projectId)
        : null;
    }
  }
  await repository.publish(input.id, input.versionId, input.baseVersionId, {
    document,
    snapshot,
    formSnapshots,
    programBindings,
  });
  return "ok" as const;
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
