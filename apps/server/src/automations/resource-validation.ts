import type {
  AutomationDefinition,
  AutomationGenerationCatalog,
  AutomationResourceKind,
  AutomationResourceOption,
} from "@openengage/core/automations";
import type { SegmentValidationResult } from "@openengage/core/segments";
import type { WorkspaceContext } from "@openengage/core/shared";
import { AutomationCatalogRepository } from "@openengage/database/automations";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { ConsentRepository } from "@openengage/database/consent";
import { ContactResourceQueryRepository } from "@openengage/database/contacts";
import { MessagingRepository } from "@openengage/database/messaging";
import { SegmentQueryRepository } from "@openengage/database/segments";
import { WebRepository } from "@openengage/database/web";
import { WorkspaceSettingsRepository } from "@openengage/database/workspaces";

import { loadSegmentCatalog, validateSegmentFilter } from "../segments/validation-service";

interface ResourceReferences {
  emailTemplates: Set<string>;
  forms: Set<string>;
  segments: Map<string, "static" | "dynamic">;
  tags: Set<string>;
  webhookEndpoints: Set<string>;
  subscriptionTopics: Set<string>;
  projects?: Map<string, Set<string>>;
  callableAutomations?: Set<string>;
  scoringCategories?: Set<string>;
}

export interface AutomationResourceContext {
  catalog: AutomationGenerationCatalog;
  validateFilter?(filter: unknown): Promise<SegmentValidationResult>;
  references: ResourceReferences;
}

export interface AutomationResourceValidationIssue {
  kind: AutomationResourceKind | "filter";
  resourceId: string;
  nodeId: string;
  message: string;
  path?: string;
}

export async function loadAutomationResourceContext(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<AutomationResourceContext> {
  const [
    templates,
    forms,
    segments,
    contactOptions,
    endpoints,
    topics,
    workspaceDetails,
    execution,
    segmentCatalog,
  ] = await Promise.all([
    new MessagingRepository(database, workspace).listEmailTemplates(false),
    new WebRepository(database, workspace).listSignupForms(),
    new SegmentQueryRepository(database, workspace).listSegments(),
    new ContactResourceQueryRepository(database, workspace).getContactOptionRows(),
    new WorkspaceSettingsRepository(database, workspace).listWebhookEndpoints(),
    new ConsentRepository(database, workspace).listTopics(),
    new WorkspaceSettingsRepository(database, workspace).getWorkspace(),
    new AutomationCatalogRepository(database, workspace).executionOptions(),
    loadSegmentCatalog(database, workspace),
  ]);

  const emailTemplates = templates
    .filter((template) => template.sendable && template.purpose === "transactional")
    .map((template) => option(template.id, template.name, template.subject))
    .slice(0, 1_000);
  const publishedForms = forms
    .filter((form) => form.status === "published")
    .map((form) => option(form.id, form.name))
    .slice(0, 1_000);
  const segmentOptions = segments
    .map((segment) =>
      option(segment.id, segment.name, segment.kind === "static" ? "リスト" : "セグメント"),
    )
    .slice(0, 1_000);
  const tagOptions = contactOptions.tags.map((tag) => option(tag.id, tag.name)).slice(0, 1_000);
  const webhookEndpoints = endpoints
    .filter((endpoint) => endpoint.enabled)
    .map((endpoint) => option(endpoint.id, endpoint.name))
    .slice(0, 1_000);
  const subscriptionTopics = topics
    .map((topic) =>
      option(topic.id, topic.name, topic.isDefault ? "既定の購読トピック" : undefined),
    )
    .slice(0, 1_000);

  return {
    validateFilter: (filter) => validateSegmentFilter(database, workspace, filter, segmentCatalog),
    catalog: {
      projects: execution.projects,
      callableAutomations: execution.callableAutomations,
      scoringCategories: execution.scoringCategories,
      timezone: workspaceDetails?.timezone ?? "UTC",
      emailTemplates,
      forms: publishedForms,
      segments: segmentOptions,
      tags: tagOptions,
      webhookEndpoints,
      subscriptionTopics,
    },
    references: {
      projects: new Map(
        execution.projects.map((project) => [
          project.id,
          new Set(project.statuses.map((status) => status.id)),
        ]),
      ),
      callableAutomations: ids(execution.callableAutomations),
      scoringCategories: ids(execution.scoringCategories),
      emailTemplates: ids(emailTemplates),
      forms: ids(publishedForms),
      segments: new Map(
        segments.map((segment) => [segment.id, segment.kind === "static" ? "static" : "dynamic"]),
      ),
      tags: ids(tagOptions),
      webhookEndpoints: ids(webhookEndpoints),
      subscriptionTopics: ids(subscriptionTopics),
    },
  };
}

export async function validateAutomationResources(
  definition: AutomationDefinition,
  context: AutomationResourceContext,
  options?: { additionalEmailTemplateIds?: readonly string[] },
): Promise<AutomationResourceValidationIssue[]> {
  const issues: AutomationResourceValidationIssue[] = [];
  const { references } = context;
  const emailTemplateIds = new Set([
    ...references.emailTemplates,
    ...(options?.additionalEmailTemplateIds ?? []),
  ]);

  for (const node of definition.nodes) {
    const filter =
      node.type === "condition" && "filter" in node.config
        ? node.config.filter
        : node.type === "source" &&
            node.config.source === "batch" &&
            node.config.audience.kind === "filter"
          ? node.config.audience.filter
          : undefined;
    if (filter) {
      if (!context.validateFilter) throw new Error("Shared segment filter validator is required");
      const result = await context.validateFilter(filter);
      for (const issue of result.issues)
        issues.push({
          kind: "filter",
          resourceId: "",
          nodeId: node.id,
          path: issue.path,
          message: `ノード ${node.id} の条件 ${issue.path}: ${issue.message}`,
        });
    }
    if (node.type === "source") {
      if ("projectId" in node.config)
        requireResource(
          issues,
          new Set(references.projects?.keys()),
          "project",
          node.config.projectId,
          node.id,
        );
      if (
        node.config.source === "batch" &&
        node.config.audience.kind === "segment" &&
        references.segments.get(node.config.audience.segmentId) !== "static"
      )
        issues.push(missingIssue("segment", node.config.audience.segmentId, node.id));
      if (node.config.source === "form_submitted") {
        requireResource(issues, references.forms, "form", node.config.formId, node.id);
      }
      if (node.config.source === "segment_joined") {
        requireResource(
          issues,
          new Set(references.segments.keys()),
          "segment",
          node.config.segmentId,
          node.id,
        );
      }
      continue;
    }

    if (node.type === "decision") {
      if (node.config.event === "form_submitted" && node.config.resourceId) {
        requireResource(issues, references.forms, "form", node.config.resourceId, node.id);
      }
      continue;
    }

    if (node.type !== "action") continue;
    switch (node.config.action) {
      case "send_email":
        requireResource(
          issues,
          emailTemplateIds,
          "email_template",
          node.config.templateId,
          node.id,
        );
        if (node.config.topicId) {
          requireResource(
            issues,
            references.subscriptionTopics,
            "subscription_topic",
            node.config.topicId,
            node.id,
          );
        }
        break;
      case "send_webhook":
        requireResource(
          issues,
          references.webhookEndpoints,
          "webhook_endpoint",
          node.config.endpointId,
          node.id,
        );
        break;
      case "add_tag":
      case "remove_tag":
        requireResource(issues, references.tags, "tag", node.config.tagId, node.id);
        break;
      case "add_segment":
      case "remove_segment": {
        const kind = references.segments.get(node.config.segmentId);
        if (!kind) {
          issues.push(missingIssue("segment", node.config.segmentId, node.id));
        } else if (kind !== "static") {
          issues.push({
            kind: "segment",
            resourceId: node.config.segmentId,
            nodeId: node.id,
            message: `ノード ${node.id} のセグメント操作はリストのみ参照できます`,
          });
        }
        break;
      }
      case "upsert_project_member": {
        const statuses = references.projects?.get(node.config.projectId);
        if (!statuses?.size || (node.config.statusId && !statuses.has(node.config.statusId)))
          issues.push(missingIssue("project", node.config.projectId, node.id));
        break;
      }
      case "call_automation":
        requireResource(
          issues,
          references.callableAutomations ?? new Set(),
          "automation",
          node.config.automationId,
          node.id,
        );
        break;
      case "change_score":
        if (node.config.categoryId)
          requireResource(
            issues,
            references.scoringCategories ?? new Set(),
            "scoring_category",
            node.config.categoryId,
            node.id,
          );
        break;
      case "update_field":
        break;
    }
  }
  return issues;
}

export function optionsForResourceKind(
  catalog: AutomationGenerationCatalog,
  kind: AutomationResourceKind,
): AutomationResourceOption[] {
  switch (kind) {
    case "project":
      return catalog.projects ?? [];
    case "automation":
      return catalog.callableAutomations ?? [];
    case "scoring_category":
      return catalog.scoringCategories ?? [];
    case "email_template":
      return catalog.emailTemplates;
    case "form":
      return catalog.forms;
    case "segment":
      return catalog.segments;
    case "tag":
      return catalog.tags;
    case "webhook_endpoint":
      return catalog.webhookEndpoints;
    case "subscription_topic":
      return catalog.subscriptionTopics;
  }
}

function option(id: string, name: string, description?: string | null): AutomationResourceOption {
  const safeName = name.trim().slice(0, 191) || id;
  const safeDescription = description?.trim().slice(0, 500);
  return { id, name: safeName, ...(safeDescription ? { description: safeDescription } : {}) };
}

function ids(options: AutomationResourceOption[]): Set<string> {
  return new Set(options.map((item) => item.id));
}

function requireResource(
  issues: AutomationResourceValidationIssue[],
  available: Set<string>,
  kind: AutomationResourceKind,
  resourceId: string,
  nodeId: string,
): void {
  if (!available.has(resourceId)) issues.push(missingIssue(kind, resourceId, nodeId));
}

function missingIssue(
  kind: AutomationResourceKind,
  resourceId: string,
  nodeId: string,
): AutomationResourceValidationIssue {
  return {
    kind,
    resourceId,
    nodeId,
    message: `ノード ${nodeId} が利用できない${resourceLabel(kind)}を参照しています`,
  };
}

function resourceLabel(kind: AutomationResourceKind): string {
  switch (kind) {
    case "project":
      return "施策";
    case "automation":
      return "呼び出し可能なフロー";
    case "scoring_category":
      return "スコアカテゴリ";
    case "email_template":
      return "メールテンプレート";
    case "form":
      return "フォーム";
    case "segment":
      return "セグメント";
    case "tag":
      return "タグ";
    case "webhook_endpoint":
      return "Webhook endpoint";
    case "subscription_topic":
      return "購読トピック";
  }
}
