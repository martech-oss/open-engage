import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { dealOptionsSchema, type DealOptions } from "@openengage/core/deals";

import { member, user } from "../auth/schema";
import { companies, contacts } from "../contacts/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { dealPipelines, deals, dealStages } from "./schema";
import type { DealOptionRows } from "./types";

const DEAL_OPTION_LIST_LIMIT = 500;

export class DealOptionsRepository extends WorkspaceRepository {
  /** Canonical API DTO; raw rows stay available only for compatibility callers. */
  public async getDealOptions(): Promise<DealOptions> {
    const rows = await this.getDealOptionRows();
    const stagesByPipeline = new Map<string, typeof rows.stages>();
    for (const stage of rows.stages) {
      const stages = stagesByPipeline.get(stage.pipelineId) ?? [];
      stages.push(stage);
      stagesByPipeline.set(stage.pipelineId, stages);
    }
    return dealOptionsSchema.parse({
      pipelines: rows.pipelines.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        isDefault: Boolean(pipeline.isDefault),
        stages: (stagesByPipeline.get(pipeline.id) ?? []).map((stage) => ({
          id: stage.id,
          name: stage.name,
          color: stage.color,
          position: Number(stage.position),
          probability: Number(stage.probability),
        })),
      })),
      contacts: rows.contacts,
      companies: rows.companies,
      members: rows.members,
    });
  }

  public async pipelineExists(pipelineId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(
        and(
          this.inWorkspace(dealPipelines),
          eq(dealPipelines.id, pipelineId),
          isNull(dealPipelines.archivedAt),
        ),
      )
      .get();
    return row !== undefined;
  }

  public async dealExists(dealId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: deals.id })
      .from(deals)
      .where(and(this.inWorkspace(deals), eq(deals.id, dealId), isNull(deals.archivedAt)))
      .get();
    return row !== undefined;
  }

  public async memberExists(userId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, this.context.workspaceId), eq(member.userId, userId)))
      .get();
    return row !== undefined;
  }

  /** Loads every filter option for the deals list/board page in one atomic batch. */
  public async getDealOptionRows(): Promise<DealOptionRows> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [pipelineRows, stageRows, contactRows, companyRows, memberRows] = await orm.batch([
      orm
        .select({
          id: dealPipelines.id,
          name: dealPipelines.name,
          isDefault: dealPipelines.isDefault,
        })
        .from(dealPipelines)
        .where(and(eq(dealPipelines.workspaceId, workspaceId), isNull(dealPipelines.archivedAt)))
        .orderBy(desc(dealPipelines.isDefault), asc(dealPipelines.name)),
      orm
        .select({
          id: dealStages.id,
          pipelineId: dealStages.pipelineId,
          name: dealStages.name,
          color: dealStages.color,
          position: dealStages.position,
          probability: dealStages.probability,
        })
        .from(dealStages)
        .where(eq(dealStages.workspaceId, workspaceId))
        .orderBy(asc(dealStages.pipelineId), asc(dealStages.position)),
      orm
        .select({
          id: contacts.id,
          email: contacts.email,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
        })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), ne(contacts.status, "archived")))
        .orderBy(
          asc(
            sql`coalesce(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.id})`,
          ),
        )
        .limit(DEAL_OPTION_LIST_LIMIT),
      orm
        .select({ id: companies.id, name: companies.name, domain: companies.domain })
        .from(companies)
        .where(eq(companies.workspaceId, workspaceId))
        .orderBy(asc(companies.name))
        .limit(DEAL_OPTION_LIST_LIMIT),
      orm
        .select({ id: user.id, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, workspaceId))
        .orderBy(asc(user.name), asc(user.email)),
    ]);
    return {
      pipelines: pipelineRows,
      stages: stageRows,
      contacts: contactRows,
      companies: companyRows,
      members: memberRows,
    };
  }
}
