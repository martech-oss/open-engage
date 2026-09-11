import type { LandingPageDocument } from "@openengage/core/web";
import { AssetRepository } from "@openengage/database/assets";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { GeneratedEmailImageRepository } from "@openengage/database/messaging";
import { LandingDesignRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { hasTurnstileConfiguration } from "./config";

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
