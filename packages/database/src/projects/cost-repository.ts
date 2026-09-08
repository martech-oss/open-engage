import { and, desc, eq, isNull } from "drizzle-orm";

import type { CampaignCostInput } from "@openengage/core/projects";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { campaignCosts, projects } from "./schema";

export class CampaignCostRepository extends WorkspaceRepository {
  public async hasProject(projectId: string) {
    return Boolean(
      await this.database.orm
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, this.context.workspaceId),
            eq(projects.id, projectId),
            isNull(projects.archivedAt),
          ),
        )
        .get(),
    );
  }
  public async list(projectId: string) {
    return await this.database.orm
      .select()
      .from(campaignCosts)
      .where(
        and(
          eq(campaignCosts.workspaceId, this.context.workspaceId),
          eq(campaignCosts.projectId, projectId),
        ),
      )
      .orderBy(desc(campaignCosts.bookedOn), desc(campaignCosts.id));
  }
  public async create(projectId: string, id: string, input: CampaignCostInput) {
    const now = nowIso();
    const inserted = await this.database.orm
      .insert(campaignCosts)
      .values({
        id,
        workspaceId: this.context.workspaceId,
        projectId,
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (inserted) return true;
    const old = await this.database.orm
      .select()
      .from(campaignCosts)
      .where(
        and(
          eq(campaignCosts.workspaceId, this.context.workspaceId),
          eq(campaignCosts.projectId, projectId),
          eq(campaignCosts.id, id),
        ),
      )
      .get();
    return (
      old !== undefined &&
      old.bookedOn === input.bookedOn &&
      old.category === input.category &&
      old.amount === input.amount &&
      old.currency === input.currency
    );
  }
  public async update(projectId: string, id: string, input: CampaignCostInput) {
    return (
      (
        await this.database.orm
          .update(campaignCosts)
          .set({ ...input, updatedAt: nowIso() })
          .where(
            and(
              eq(campaignCosts.workspaceId, this.context.workspaceId),
              eq(campaignCosts.projectId, projectId),
              eq(campaignCosts.id, id),
            ),
          )
          .returning({ id: campaignCosts.id })
      ).length > 0
    );
  }
  public async remove(projectId: string, id: string) {
    return (
      (
        await this.database.orm
          .delete(campaignCosts)
          .where(
            and(
              eq(campaignCosts.workspaceId, this.context.workspaceId),
              eq(campaignCosts.projectId, projectId),
              eq(campaignCosts.id, id),
            ),
          )
          .returning({ id: campaignCosts.id })
      ).length > 0
    );
  }
}
