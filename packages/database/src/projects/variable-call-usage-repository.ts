import {
  automationDefinitionSchema,
  automationDependencySchema,
  automationVariableReferences,
  type AutomationDefinition,
  type AutomationDependency,
} from "@openengage/core/automations";
import type { VariableUsage } from "@openengage/core/projects";

import { AutomationPublicationRepository } from "../automations/call-repository";
import { WorkspaceRepository } from "../shared/repository-base";
import { inspectUsage } from "./variable-usage-analysis";

/** Read-only call-site traversal mirrors publication's inherited context and pin selection. */
export class VariableCallUsageRepository extends WorkspaceRepository {
  private published = new Map<string, Promise<AutomationDependency | null>>();

  private load(id: string) {
    let result = this.published.get(id);
    if (!result) {
      result = new AutomationPublicationRepository(this.database, this.context).publishedDependency(
        id,
      );
      this.published.set(id, result);
    }
    return result;
  }

  async list(root: VariableUsage, graph: AutomationDefinition, savedDependencies: string) {
    const uses: VariableUsage[] = [];
    let count = 0;
    const diagnostic = (path: string[], message: string) =>
      uses.push({
        ...root,
        references: [],
        snapshot: null,
        dependencyPath: path,
        diagnostics: [message],
      });
    const visit = async (
      source: AutomationDefinition,
      path: string[],
      ancestors: string[],
      pinned?: Record<string, AutomationDependency>,
    ): Promise<void> => {
      for (const node of source.nodes) {
        if (node.type !== "action" || node.config.action !== "call_automation") continue;
        const callPath = [...path, `call:${node.id}`];
        if (++count > 100 || ancestors.length >= 20) {
          diagnostic(callPath, "Callable dependency limit exceeded");
          return;
        }
        const id = node.config.automationId;
        if (ancestors.includes(id)) {
          diagnostic(callPath, "Callable automation cycle");
          continue;
        }
        try {
          const child = pinned ? pinned[node.id] : await this.load(id);
          if (!child || child.automationId !== id) {
            diagnostic(callPath, `Published callable automation unavailable: ${id}`);
            continue;
          }
          const childGraph = automationDefinitionSchema.parse(child.sourceGraph ?? child.graph);
          uses.push({
            ...root,
            dependencyPath: callPath,
            ...inspectUsage((text) => automationVariableReferences(childGraph, text)),
            // Draft children will be resolved afresh in the parent's context at publication.
            snapshot: root.published ? child.variableSnapshot : null,
          });
          await visit(childGraph, callPath, [...ancestors, id], child.dependencies);
        } catch (error) {
          diagnostic(
            callPath,
            error instanceof Error ? error.message : "Invalid callable dependency",
          );
        }
      }
    };
    try {
      const pinned = root.published
        ? Object.fromEntries(
            Object.entries(JSON.parse(savedDependencies) as Record<string, unknown>).map(
              ([key, value]) => [key, automationDependencySchema.parse(value)],
            ),
          )
        : undefined;
      await visit(graph, [], [root.resourceId], pinned);
    } catch (error) {
      diagnostic([], error instanceof Error ? error.message : "Invalid callable dependencies");
    }
    return uses;
  }
}
