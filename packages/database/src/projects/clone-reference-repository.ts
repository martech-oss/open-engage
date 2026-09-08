import { sql, type SQL } from "drizzle-orm";

import type { ProjectClonePreview } from "@openengage/core/projects";

import { assets } from "../assets/schema";
import { member } from "../auth/schema";
import { automations, automationVersions } from "../automations/schema";
import { subscriptionTopics } from "../consent/schema";
import { tags } from "../contacts/schema";
import { assignmentGroups } from "../deals/sales-schema";
import { dealStages } from "../deals/schema";
import { emailTemplates } from "../messaging/schema";
import { scoringCategories } from "../scoring/schema";
import { segments } from "../segments/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import {
  customRedirects,
  forms,
  formVersions,
  landingPages,
  landingPageVersions,
} from "../web/schema";
import { webhookEndpoints } from "../workspaces/schema";
import { ProjectCloneError, type ProjectCloneCapture } from "./clone-types";
import { projects } from "./schema";

const referenceKinds: Record<string, string> = {
  projectId: "project",
  variableProjectId: "project",
  contextProjectId: "project",
  variableContextProjectId: "project",
  formId: "form",
  formVersionId: "form_version",
  pageId: "landing_page",
  pageVersionId: "landing_page_version",
  automationId: "automation",
  automationVersionId: "automation_version",
  templateId: "email_sequence",
  segmentId: "segment",
  redirectId: "redirect",
  assetId: "asset",
  tagId: "tag",
  endpointId: "webhook",
  ownerUserId: "user",
  assignmentGroupId: "assignment_group",
  groupId: "assignment_group",
  topicId: "topic",
  categoryId: "scoring_category",
};
const jsonColumns = new Set([
  "graph",
  "definition",
  "document",
  "contentDocument",
  "formBindings",
  "filterAst",
  "variants",
  "rules",
  "draftContent",
]);
const tables = {
  project: projects,
  form: forms,
  form_version: formVersions,
  landing_page: landingPages,
  landing_page_version: landingPageVersions,
  automation: automations,
  automation_version: automationVersions,
  email_sequence: emailTemplates,
  segment: segments,
  redirect: customRedirects,
  asset: assets,
  tag: tags,
  webhook: webhookEndpoints,
  assignment_group: assignmentGroups,
  topic: subscriptionTopics,
  scoring_category: scoringCategories,
  deal_stage: dealStages,
};

/** Used again inside the final transaction, so revoked/deleted shared references abort materialization. */
export function projectCloneReferenceGuard(
  workspaceId: string,
  reference: { kind: string; id: string; slug?: string | undefined },
): SQL {
  if (reference.kind === "user")
    return sql`EXISTS (SELECT 1 FROM ${member} WHERE ${member.organizationId} = ${workspaceId} AND ${member.userId} = ${reference.id})`;
  const table = tables[reference.kind as keyof typeof tables];
  if (!table) return sql`0`;
  const slugGuard =
    reference.slug !== undefined && "slug" in table
      ? sql` AND ${table.slug} = ${reference.slug}`
      : sql``;
  return sql`EXISTS (SELECT 1 FROM ${table} WHERE ${table.workspaceId} = ${workspaceId} AND ${table.id} = ${reference.id}${slugGuard})`;
}

export class ProjectCloneReferenceRepository extends WorkspaceRepository {
  public async collect(
    capture: ProjectCloneCapture,
  ): Promise<ProjectClonePreview["sharedReferences"]> {
    const found = new Map<string, ProjectClonePreview["sharedReferences"][number]>();
    const slugs = new Map<string, { kind: "segment" | "tag" | "topic"; slug: string }>();
    const add = (kind: string, id: string) => {
      if (Object.hasOwn(capture.referenceMap.ids, id)) return;
      found.set(`${kind}:${id}`, { kind, id, name: id });
    };
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const condition = value as Record<string, unknown>;
      if (condition.kind === "condition") {
        const slugKind = ({ segment: "segment", tag: "tag", subscription: "topic" } as const)[
          condition.field as "segment" | "tag" | "subscription"
        ];
        const idKind = (
          {
            project_id: "project",
            owner_user_id: "user",
            deal_owner_user_id: "user",
            deal_stage_id: "deal_stage",
          } as const
        )[
          condition.field as "project_id" | "owner_user_id" | "deal_owner_user_id" | "deal_stage_id"
        ];
        if (slugKind || (idKind && ["eq", "neq", "in"].includes(String(condition.operator)))) {
          for (const item of Array.isArray(condition.value) ? condition.value : [condition.value]) {
            if (typeof item !== "string" || !item) continue;
            if (slugKind) {
              if (slugKind === "segment" && Object.hasOwn(capture.referenceMap.segmentSlugs, item))
                continue;
              slugs.set(`${slugKind}:${item}`, { kind: slugKind, slug: item });
            } else add(idKind!, item);
          }
        }
        if (condition.field === "category_score" && typeof condition.key === "string")
          add("scoring_category", condition.key);
      }
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string" && item && referenceKinds[key])
          add(referenceKinds[key]!, item);
        else if (typeof item === "string" && jsonColumns.has(key)) {
          try {
            visit(JSON.parse(item));
          } catch {
            /* Legacy plain email text is not a reference document. */
          }
        } else visit(item);
      }
    };
    for (const snapshot of capture.snapshots) {
      if (snapshot.resource.kind !== "brief") visit(snapshot.row);
    }
    if (capture.options.ownerUserId) add("user", capture.options.ownerUserId);
    if (capture.options.approverUserId) add("user", capture.options.approverUserId);
    for (const { kind, slug } of slugs.values()) {
      const table = tables[kind];
      const row = await this.database.first<{ id: string; name: string }>(
        sql`SELECT ${table.id} AS id, ${table.name} AS name FROM ${table} WHERE ${table.workspaceId} = ${this.context.workspaceId} AND ${table.slug} = ${slug}`,
      );
      if (!row)
        throw new ProjectCloneError(
          "invalid",
          `Workspace内で参照先を確認できません: ${kind} ${slug}`,
        );
      found.set(`${kind}:${row.id}`, { kind, ...row, slug });
    }
    const references = [...found.values()];
    if (references.length > 200)
      throw new ProjectCloneError("invalid", "共有参照が多すぎます（最大200件）");
    for (const reference of references) {
      const exists = await this.database.first<{ valid: number }>(
        sql`SELECT ${projectCloneReferenceGuard(this.context.workspaceId, reference)} AS valid`,
      );
      if (!exists?.valid)
        throw new ProjectCloneError(
          "invalid",
          `Workspace内で参照先を確認できません: ${reference.kind} ${reference.id}`,
        );
      if (reference.kind !== "user") {
        const table = tables[reference.kind as keyof typeof tables];
        if (table && "name" in table) {
          const row = await this.database.first<{ name: string }>(
            sql`SELECT ${table.name} AS name FROM ${table} WHERE ${table.workspaceId} = ${this.context.workspaceId} AND ${table.id} = ${reference.id}`,
          );
          if (row) reference.name = row.name;
        }
      }
    }
    return references;
  }
}
