import { and, asc, desc, eq } from "drizzle-orm";

import { type SegmentFilter } from "@openengage/core/segments";

import { subscriptionTopics } from "../consent/schema";
import {
  companies,
  contactEvents,
  contacts,
  customFieldDefinitions,
  tags,
} from "../contacts/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { segments } from "./schema";
import { filterAstCodec } from "./support";

export class SegmentCatalogRepository extends WorkspaceRepository {
  public async loadGenerationCatalogRows(): Promise<{
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
    ]);
    return {
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
