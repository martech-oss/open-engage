import {
  type AutomationDefinition,
  type AutomationDraft,
  validateAutomation,
} from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import { MessagingRepository, type OpenEngageDatabase } from "@openengage/database";

import { loadAutomationResourceContext, validateAutomationResources } from "./resource-validation";

export async function getAutomationPublishability(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  graph: AutomationDefinition,
): Promise<AutomationDraft["publishability"]> {
  const emailNodes = graph.nodes.filter(
    (node): node is Extract<typeof node, { type: "action" }> =>
      node.type === "action" && node.config.action === "send_email",
  );
  const templateIds = emailNodes.flatMap((node) =>
    node.config.action === "send_email" ? [node.config.templateId] : [],
  );
  const [templates, resources] = await Promise.all([
    new MessagingRepository(database, workspace).getEmailTemplatesByIds(templateIds),
    loadAutomationResourceContext(database, workspace),
  ]);
  const byId = new Map(templates.map((template) => [template.id, template]));
  const templateStates = emailNodes.map((node) => {
    const templateId =
      node.config.action === "send_email" ? node.config.templateId : "unreachable-template";
    const template = byId.get(templateId);
    const reason = templateReason(template);
    return {
      nodeId: node.id,
      templateId,
      name: template?.name ?? null,
      purpose: template?.purpose ?? null,
      published: template?.publishedRevision !== null && template !== undefined,
      archived: template?.archivedAt !== null && template !== undefined,
      publishable: reason === null,
      reason,
    };
  });
  const graphIssues = validateAutomation(graph).map((issue) => issue.message);
  const resourceIssues = validateAutomationResources(graph, resources).map(
    (issue) => issue.message,
  );
  const issues = [
    ...new Set([
      ...graphIssues,
      ...resourceIssues,
      ...templateStates.flatMap((item) => item.reason ?? []),
    ]),
  ];
  const isSequence = graph.metadata?.origin === "email_sequence";
  return {
    publishable: issues.length === 0,
    capabilityState: isSequence
      ? templates.some((template) => template.purpose === "marketing")
        ? "delivery-capability-blocked"
        : "transactional-compatible"
      : null,
    issues,
    templates: templateStates,
  };
}

function templateReason(
  template: Awaited<ReturnType<MessagingRepository["getEmailTemplatesByIds"]>>[number] | undefined,
): string | null {
  if (!template) return "参照しているメールテンプレートが見つかりません";
  if (template.archivedAt) return `メールテンプレート「${template.name}」はアーカイブ済みです`;
  if (template.purpose === "marketing") {
    return `メールテンプレート「${template.name}」はMarketing送信未対応です`;
  }
  if (template.publishedRevision === null) {
    return `メールテンプレート「${template.name}」が未公開です`;
  }
  return null;
}
