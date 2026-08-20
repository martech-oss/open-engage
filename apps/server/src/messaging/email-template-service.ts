import type {
  EmailBrandProfile,
  EmailDocumentV2,
  EmailTemplateUpdate,
  EmailTemplateWrite,
} from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import { AssetRepository } from "@openengage/database/assets";
import { type OpenEngageDatabase } from "@openengage/database/client";
import {
  EmailDesignRepository,
  GeneratedEmailImageRepository,
  MessagingRepository,
} from "@openengage/database/messaging";

import { loadAssetOrigin, toAssetSummary } from "../assets/service";
import { previewEmailTemplate } from "../rendering/email-renderer";

export type EmailTemplateServiceFailure =
  | "invalid_asset"
  | "marketing_brand_incomplete"
  | "not_found";

export class EmailTemplateServiceError extends Error {
  public constructor(public readonly kind: EmailTemplateServiceFailure) {
    super(`Email template operation failed: ${kind}`);
    this.name = "EmailTemplateServiceError";
  }
}

export async function createEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: EmailTemplateWrite,
): Promise<{ id: string }> {
  const assets = await validateDraftAssets(database, workspace, input.content);
  const result = await new MessagingRepository(database, workspace).createEmailTemplate(input);
  await new GeneratedEmailImageRepository(database).claim(workspace.workspaceId, [
    ...assets.generated,
  ]);
  return result;
}

export async function updateEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: EmailTemplateUpdate,
): Promise<void> {
  const assets = await validateDraftAssets(database, workspace, input.content);
  const updated = await new MessagingRepository(database, workspace).updateEmailTemplate(id, input);
  if (!updated) throw new EmailTemplateServiceError("not_found");
  await new GeneratedEmailImageRepository(database).claim(workspace.workspaceId, [
    ...assets.generated,
  ]);
}

export async function previewEmailTemplateDraft(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  appUrl: string,
  input: Pick<EmailTemplateWrite, "purpose" | "subject" | "content">,
) {
  const renderOptions = await resolveEmailRenderOptions(
    database,
    workspace.workspaceId,
    appUrl,
    input.content,
    true,
  );
  return previewEmailTemplate(input, renderOptions);
}

export async function publishEmailTemplate(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  appUrl: string,
  id: string,
): Promise<void> {
  const repository = new MessagingRepository(database, workspace);
  const template = await repository.getEmailTemplate(id);
  if (!template || template.archivedAt) throw new EmailTemplateServiceError("not_found");
  const { brand } = await resolveEmailRenderOptions(
    database,
    workspace.workspaceId,
    appUrl,
    template.content,
    false,
  );
  if (
    template.purpose === "marketing" &&
    (!brand.brandName.trim() || !brand.postalAddress.trim())
  ) {
    throw new EmailTemplateServiceError("marketing_brand_incomplete");
  }
  if (!(await repository.publishEmailTemplate(id))) {
    throw new EmailTemplateServiceError("not_found");
  }
}

export async function resolveEmailRenderOptions(
  database: OpenEngageDatabase,
  workspaceId: string,
  appUrl: string,
  document: EmailDocumentV2,
  allowTemporary: boolean,
): Promise<{
  brand: EmailBrandProfile;
  assetUrls: Record<string, string>;
}> {
  const scope = { workspaceId };
  const brand = await new EmailDesignRepository(database, scope).getBrandProfile();
  const requiredIds = collectEmailAssetIds(document);
  const ids = new Set(requiredIds);
  if (brand.logoAssetId) ids.add(brand.logoAssetId);
  const rows = await new AssetRepository(database, scope).getByIds([...ids]);
  const origin = await loadAssetOrigin(database, workspaceId, appUrl);
  const generated = new GeneratedEmailImageRepository(database);
  const now = new Date().toISOString();
  const assetUrls: Record<string, string> = {};
  const privateIds = rows
    .filter((row) => row.visibility !== "public" && row.archivedAt === null)
    .map((row) => row.id);
  const temporaryIds = allowTemporary
    ? await generated.availableUnclaimed(workspaceId, privateIds, now)
    : new Set<string>();

  for (const row of rows) {
    if (row.kind !== "image" || row.archivedAt !== null) continue;
    const publicUrl = toAssetSummary(row, origin).publicUrl;
    if (publicUrl) {
      assetUrls[row.id] = publicUrl;
      continue;
    }
    if (temporaryIds.has(row.id)) {
      assetUrls[row.id] = `${appUrl.replace(/\/$/, "")}/api/email-images/${row.id}/preview`;
    }
  }

  if ([...requiredIds].some((id) => !assetUrls[id])) {
    throw new EmailTemplateServiceError("invalid_asset");
  }
  return { brand, assetUrls };
}

export function collectEmailAssetIds(document: EmailDocumentV2): Set<string> {
  const ids = new Set<string>();
  collectV2AssetIds(document, ids);
  return ids;
}

function collectV2AssetIds(document: EmailDocumentV2, ids: Set<string>): void {
  for (const block of document.blocks) {
    if (block.type === "image") {
      ids.add(block.source.assetId);
    } else if (block.type === "columns") {
      for (const column of block.columns) {
        for (const child of column.blocks) {
          if (child.type === "image") {
            ids.add(child.source.assetId);
          }
        }
      }
    } else if (block.type === "conditional") {
      for (const child of block.blocks) {
        if (child.type === "image") {
          ids.add(child.source.assetId);
        }
      }
    }
  }
}

async function validateDraftAssets(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  document: EmailDocumentV2,
): Promise<{ generated: Set<string> }> {
  const ids = collectEmailAssetIds(document);
  if (ids.size === 0) return { generated: new Set() };
  const repository = new AssetRepository(database, workspace);
  const rows = await repository.getByIds([...ids]);
  const publicIds = new Set(
    rows
      .filter(
        (row) => row.kind === "image" && row.visibility === "public" && row.archivedAt === null,
      )
      .map((row) => row.id),
  );
  const pending = [...ids].filter((id) => !publicIds.has(id));
  const generated = await new GeneratedEmailImageRepository(database).availableUnclaimed(
    workspace.workspaceId,
    pending,
    new Date().toISOString(),
  );
  if ([...ids].some((id) => !publicIds.has(id) && !generated.has(id))) {
    throw new EmailTemplateServiceError("invalid_asset");
  }
  return { generated };
}
