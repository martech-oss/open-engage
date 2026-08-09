import type {
  AutomationDefinition,
  AutomationGenerationCatalog,
  AutomationResourceKind,
  AutomationResourceOption,
} from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  ConsentRepository,
  ContactResourceRepository,
  MessagingRepository,
  type OpenEngageDatabase,
  SegmentRepository,
  WebRepository,
  WorkspaceSettingsRepository,
} from "@openengage/database";

interface ResourceReferences {
  emailTemplates: Set<string>;
  forms: Set<string>;
  segments: Map<string, "static" | "dynamic">;
  tags: Set<string>;
  webhookEndpoints: Set<string>;
  subscriptionTopics: Set<string>;
}

export interface AutomationResourceContext {
  catalog: AutomationGenerationCatalog;
  references: ResourceReferences;
}

export interface AutomationResourceValidationIssue {
  kind: AutomationResourceKind;
  resourceId: string;
  nodeId: string;
  message: string;
}

export async function loadAutomationResourceContext(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<AutomationResourceContext> {
  const [templates, forms, segments, contactOptions, endpoints, topics, workspaceDetails] =
    await Promise.all([
      new MessagingRepository(database, workspace).listEmailTemplates(false),
      new WebRepository(database, workspace).listSignupForms(),
      new SegmentRepository(database, workspace).listSegments(),
      new ContactResourceRepository(database, workspace).getContactOptionRows(),
      new WorkspaceSettingsRepository(database, workspace).listWebhookEndpoints(),
      new ConsentRepository(database, workspace).listTopics(),
      new WorkspaceSettingsRepository(database, workspace).getWorkspace(),
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
      option(
        segment.id,
        segment.name,
        segment.kind === "static" ? "静的セグメント" : "動的セグメント",
      ),
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
    catalog: {
      timezone: workspaceDetails?.timezone ?? "UTC",
      emailTemplates,
      forms: publishedForms,
      segments: segmentOptions,
      tags: tagOptions,
      webhookEndpoints,
      subscriptionTopics,
    },
    references: {
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

export function validateAutomationResources(
  definition: AutomationDefinition,
  context: AutomationResourceContext,
): AutomationResourceValidationIssue[] {
  const issues: AutomationResourceValidationIssue[] = [];
  const { references } = context;

  for (const node of definition.nodes) {
    if (node.type === "source") {
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
          references.emailTemplates,
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
            message: `ノード ${node.id} のセグメント操作は静的セグメントのみ参照できます`,
          });
        }
        break;
      }
      case "change_score":
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
