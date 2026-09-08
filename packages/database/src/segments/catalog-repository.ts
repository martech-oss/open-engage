import { and, asc, desc, eq, isNull, or } from "drizzle-orm";

import { projectProgramDefinitionSchema } from "@openengage/core/projects";
import { type SegmentFilter, type SegmentResourceOption } from "@openengage/core/segments";

import { subscriptionTopics } from "../consent/schema";
import {
  companies,
  contactEvents,
  contacts,
  customFieldDefinitions,
  tags,
} from "../contacts/schema";
import { dealStages, dealPipelines } from "../deals/schema";
import { projectProgramVersions } from "../projects/program-schema";
import { projects } from "../projects/schema";
import { scoringCategories } from "../scoring/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { segments } from "./schema";
import { filterAstCodec } from "./support";

export class SegmentCatalogRepository extends WorkspaceRepository {
  public async loadReferencedProgramStatusOptions(
    filter: SegmentFilter,
  ): Promise<SegmentResourceOption[]> {
    const references = new Map<string, { projectId: string; definitionVersion: number }>();
    function collect(node: SegmentFilter): void {
      if (node.kind === "group") node.children.forEach(collect);
      else if (node.program)
        references.set(
          JSON.stringify([node.program.projectId, node.program.definitionVersion]),
          node.program,
        );
    }
    collect(filter);
    const versions = [...references.values()];
    const options: SegmentResourceOption[] = [];
    // Keep each query below D1's bind limit, independent of the picker catalog cap.
    for (let offset = 0; offset < versions.length; offset += 40) {
      const rows = await this.database.orm
        .select()
        .from(projectProgramVersions)
        .where(
          and(
            this.inWorkspace(projectProgramVersions),
            or(
              ...versions
                .slice(offset, offset + 40)
                .map((reference) =>
                  and(
                    eq(projectProgramVersions.projectId, reference.projectId),
                    eq(projectProgramVersions.version, reference.definitionVersion),
                  ),
                ),
            ),
          ),
        );
      options.push(...rows.flatMap((version) => programStatusOptions(version)));
    }
    return options;
  }

  public async loadGenerationCatalogRows(): Promise<{
    projects: Array<{ id: string; name: string }>;
    projectStatuses: Array<{ id: string; name: string; value: string }>;
    categories: Array<{ id: string; name: string }>;
    companyCustomFields: Array<{ id: string; key: string; label: string; dataType: string }>;
    dealStages: Array<{ id: string; name: string }>;
    tags: Array<{ id: string; name: string; slug: string }>;
    staticSegments: Array<{ id: string; name: string; slug: string }>;
    companies: Array<{ id: string; name: string }>;
    subscriptionTopics: Array<{ id: string; name: string; slug: string; description: string }>;
    events: Array<{ type: string; resourceId: string | null }>;
    customFields: Array<{ id: string; key: string; label: string; dataType: string }>;
    stages: Array<{ stage: string }>;
  }> {
    const orm = this.database.orm;
    const [
      tagRows,
      staticSegmentRows,
      companyRows,
      topicRows,
      eventRows,
      customFieldRows,
      stageRows,
      categoryRows,
      companyFieldRows,
      dealStageRows,
    ] = await orm.batch([
      orm
        .select({ id: tags.id, name: tags.name, slug: tags.slug })
        .from(tags)
        .where(this.inWorkspace(tags))
        .orderBy(asc(tags.name))
        .limit(1_000),
      orm
        .select({ id: segments.id, name: segments.name, slug: segments.slug })
        .from(segments)
        .where(and(this.inWorkspace(segments), eq(segments.kind, "static")))
        .orderBy(asc(segments.name))
        .limit(1_000),
      orm
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(this.inWorkspace(companies))
        .orderBy(asc(companies.name))
        .limit(1_000),
      orm
        .select({
          id: subscriptionTopics.id,
          name: subscriptionTopics.name,
          slug: subscriptionTopics.slug,
          description: subscriptionTopics.description,
        })
        .from(subscriptionTopics)
        .where(this.inWorkspace(subscriptionTopics))
        .orderBy(asc(subscriptionTopics.name))
        .limit(1_000),
      orm
        .selectDistinct({ type: contactEvents.type, resourceId: contactEvents.resourceId })
        .from(contactEvents)
        .where(this.inWorkspace(contactEvents))
        .orderBy(desc(contactEvents.occurredAt))
        .limit(1_000),
      orm
        .select({
          id: customFieldDefinitions.id,
          key: customFieldDefinitions.key,
          label: customFieldDefinitions.label,
          dataType: customFieldDefinitions.dataType,
        })
        .from(customFieldDefinitions)
        .where(
          and(
            this.inWorkspace(customFieldDefinitions),
            eq(customFieldDefinitions.entityType, "contact"),
          ),
        )
        .orderBy(asc(customFieldDefinitions.label))
        .limit(1_000),
      orm
        .selectDistinct({ stage: contacts.stage })
        .from(contacts)
        .where(this.inWorkspace(contacts))
        .orderBy(asc(contacts.stage))
        .limit(1_000),
      orm
        .select({ id: scoringCategories.id, name: scoringCategories.name })
        .from(scoringCategories)
        .where(this.inWorkspace(scoringCategories))
        .limit(1000),
      orm
        .select({
          id: customFieldDefinitions.id,
          key: customFieldDefinitions.key,
          label: customFieldDefinitions.label,
          dataType: customFieldDefinitions.dataType,
        })
        .from(customFieldDefinitions)
        .where(
          and(
            this.inWorkspace(customFieldDefinitions),
            eq(customFieldDefinitions.entityType, "company"),
          ),
        )
        .limit(1000),
      orm
        .select({ id: dealStages.id, name: dealStages.name })
        .from(dealStages)
        .innerJoin(dealPipelines, eq(dealStages.pipelineId, dealPipelines.id))
        .where(this.inWorkspace(dealPipelines))
        .limit(1000),
    ]);
    const programProjects = await orm
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(this.inWorkspace(projects), isNull(projects.archivedAt)))
      .limit(1000);
    const programVersions = await orm
      .select()
      .from(projectProgramVersions)
      .where(this.inWorkspace(projectProgramVersions))
      .orderBy(desc(projectProgramVersions.version))
      .limit(1000);
    return {
      projects: programProjects,
      projectStatuses: programVersions
        .flatMap((version) =>
          programStatusOptions(
            version,
            programProjects.find((project) => project.id === version.projectId)?.name,
          ),
        )
        .slice(0, 1000),
      categories: categoryRows,
      companyCustomFields: companyFieldRows,
      dealStages: dealStageRows,
      tags: tagRows,
      staticSegments: staticSegmentRows,
      companies: companyRows,
      subscriptionTopics: topicRows,
      events: eventRows,
      customFields: customFieldRows,
      stages: stageRows,
    };
  }

  public async listDynamicDefinitions(): Promise<
    Array<{ id: string; filterAst: SegmentFilter; filterVersion: number }>
  > {
    const rows = await this.database.orm
      .select({
        id: segments.id,
        filterAst: segments.filterAst,
        filterVersion: segments.filterVersion,
      })
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.kind, "dynamic")))
      .orderBy(asc(segments.id));
    return rows.flatMap((row) => {
      const filterAst = filterAstCodec.decodeNullable(row.filterAst);
      return filterAst ? [{ id: row.id, filterAst, filterVersion: row.filterVersion }] : [];
    });
  }
}

function programStatusOptions(
  version: { projectId: string; version: number; definition: string },
  projectName = version.projectId,
): SegmentResourceOption[] {
  return projectProgramDefinitionSchema
    .parse(JSON.parse(version.definition))
    .statuses.map((status) => ({
      id: `${version.projectId}:${version.version}:${status.id}`,
      value: JSON.stringify([version.projectId, version.version, status.id]),
      programStatus: {
        projectId: version.projectId,
        definitionVersion: version.version,
        statusId: status.id,
      },
      name: `${projectName} / v${version.version} / ${status.label}`,
    }));
}
