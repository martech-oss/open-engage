import { automationDefinitionSchema, latestAutomationSlot } from "@openengage/core/automations";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { OperationHealthRepository } from "@openengage/database/platform";

export async function operationHealth(
  database: OpenEngageDatabase,
  workspaceId: string,
  now = new Date(),
) {
  const repository = new OperationHealthRepository(database, { workspaceId });
  const issues = await repository.failures();
  for (const automation of await repository.schedules()) {
    const graph = automationDefinitionSchema.parse(JSON.parse(automation.graph));
    const source = graph.nodes.find((node) => node.type === "source");
    if (source?.config.source !== "batch") continue;
    const slot = latestAutomationSlot(
      source.config.schedule,
      new Date(automation.lastSlot ?? automation.publishedAt ?? now.toISOString()),
      now,
      graph.timezone,
    );
    if (!slot || now.getTime() - slot.getTime() < 5 * 60_000) continue;
    issues.push({
      id: `schedule:${automation.id}:${slot.toISOString()}`,
      kind: "schedule_delay",
      name: graph.name,
      message: "予定時刻から5分以上経過しています。CronとQueueの稼働状況を確認してください。",
      occurredAt: slot.toISOString(),
      projectId: graph.variableProjectId ?? null,
      automationId: automation.id,
      runId: null,
      enrollmentId: null,
    });
  }
  return {
    checkedAt: now.toISOString(),
    issues: issues.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
  };
}
