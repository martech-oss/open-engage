import type { GenerateEmailImageInput, GeneratedEmailImage } from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import { AssetRepository } from "@openengage/database/assets";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { GeneratedEmailImageRepository } from "@openengage/database/messaging";

import { loadAssetOrigin, uploadAsset } from "../assets/service";
import type { RuntimeEnv } from "../env";

const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b" as const;
const IMAGE_TIMEOUT_MS = 55_000;
const GENERATED_IMAGE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;

export type EmailImageGenerationFailure = "failed" | "timeout" | "unavailable";

export class EmailImageGenerationError extends Error {
  public constructor(
    public readonly kind: EmailImageGenerationFailure,
    options?: ErrorOptions,
  ) {
    super(`Email image generation ${kind}`, options);
    this.name = "EmailImageGenerationError";
  }
}

export async function generateEmailImage(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateEmailImageInput,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<GeneratedEmailImage> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timeout", "AbortError")),
    IMAGE_TIMEOUT_MS,
  );
  let image: string | undefined;
  try {
    const form = new FormData();
    form.set(
      "prompt",
      `Wide editorial illustration for an email. No words, letters, logos, trademarks, interface screenshots, or watermarks. ${input.prompt}`,
    );
    form.set("width", "1200");
    form.set("height", "672");
    const multipart = new Response(form);
    const contentType = multipart.headers.get("content-type");
    if (!contentType) throw new EmailImageGenerationError("failed");
    const result = await env.AI.run(
      IMAGE_MODEL,
      { multipart: { body: await multipart.arrayBuffer(), contentType } },
      { signal: controller.signal, tags: ["openengage", "email-designer"] },
    );
    image = result.image;
  } catch (error) {
    if (error instanceof EmailImageGenerationError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      throw new EmailImageGenerationError("timeout", { cause: error });
    }
    throw new EmailImageGenerationError("unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const body = decodeImage(image);
  const expiresAt = new Date(Date.now() + GENERATED_IMAGE_TTL_MS).toISOString();
  const origin = await loadAssetOrigin(database, workspace.workspaceId, env.APP_URL);
  let uploadedAssetId: string | null = null;
  try {
    const asset = await uploadAsset(
      database,
      env.ASSETS_BUCKET,
      workspace,
      {
        name: `AIメール画像-${input.requestId}.png`,
        body,
        contentType: "image/png",
        visibility: "private",
      },
      origin,
      background,
    );
    uploadedAssetId = asset.id;
    await new AssetRepository(database, workspace).updateMetadata(asset.id, {
      name: asset.name,
      description: "AIメールデザイナーで生成した一時画像",
      altText: input.alt,
      visibility: "private",
    });
    await new GeneratedEmailImageRepository(database).track({
      assetId: asset.id,
      workspaceId: workspace.workspaceId,
      requestId: input.requestId,
      expiresAt,
    });
    return {
      assetId: asset.id,
      previewUrl: `${env.APP_URL.replace(/\/$/, "")}/api/email-images/${asset.id}/preview`,
      alt: input.alt,
      expiresAt,
    };
  } catch (error) {
    if (uploadedAssetId) {
      const repository = new AssetRepository(database, workspace);
      const row = await repository.getById(uploadedAssetId).catch(() => null);
      if (row) await env.ASSETS_BUCKET.delete(row.r2Key).catch(() => undefined);
      await repository.deleteRow(uploadedAssetId).catch(() => undefined);
    }
    if (error instanceof EmailImageGenerationError) throw error;
    throw new EmailImageGenerationError("failed", { cause: error });
  }
}

function decodeImage(encoded: string | undefined): ArrayBuffer {
  if (!encoded) throw new EmailImageGenerationError("failed");
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
      throw new EmailImageGenerationError("failed");
    }
    return bytes.buffer;
  } catch (error) {
    if (error instanceof EmailImageGenerationError) throw error;
    throw new EmailImageGenerationError("failed", { cause: error });
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
