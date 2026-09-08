import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { CustomRedirect, CustomRedirectWrite } from "@openengage/core/web";

import { organization } from "../auth/schema";
import { contacts } from "../contacts/schema";
import { visitorBindings } from "../contacts/visitor-schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { customRedirects } from "./schema";

const redirectSelection = {
  id: customRedirects.id,
  name: customRedirects.name,
  slug: customRedirects.slug,
  destinationUrl: customRedirects.destinationUrl,
  clickCount: customRedirects.clickCount,
  createdAt: customRedirects.createdAt,
  updatedAt: customRedirects.updatedAt,
};

/** Authenticated CRUD for the redirect catalog. */
export class CustomRedirectRepository extends WorkspaceRepository {
  public listRedirects(): Promise<CustomRedirect[]> {
    return this.database.orm
      .select(redirectSelection)
      .from(customRedirects)
      .where(and(this.inWorkspace(customRedirects), isNull(customRedirects.archivedAt)))
      .orderBy(desc(customRedirects.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
  }

  public async createRedirect(input: CustomRedirectWrite): Promise<{ id: string }> {
    const now = nowIso();
    const id = uuidv7();
    await this.database.orm.insert(customRedirects).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      destinationUrl: input.destinationUrl,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateRedirect(id: string, input: CustomRedirectWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(customRedirects)
      .set({
        name: input.name,
        slug: input.slug,
        destinationUrl: input.destinationUrl,
        updatedAt: nowIso(),
      })
      .where(
        and(
          this.inWorkspace(customRedirects),
          eq(customRedirects.id, id),
          isNull(customRedirects.archivedAt),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }

  public async archiveRedirect(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(customRedirects)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(customRedirects),
          eq(customRedirects.id, id),
          isNull(customRedirects.archivedAt),
        ),
      )
      .run();
    return changedExactlyOne(result);
  }
}

export interface PublicRedirectMatch {
  id: string;
  workspaceId: string;
  destinationUrl: string;
}

/** Resolution and click accounting for the unauthenticated `/r/:slug` route. */
export class PublicCustomRedirectRepository extends DatabaseRepository {
  public async findRedirect(
    workspaceSlug: string,
    redirectSlug: string,
  ): Promise<PublicRedirectMatch | null> {
    const row = await this.database.orm
      .select({
        id: customRedirects.id,
        workspaceId: customRedirects.workspaceId,
        destinationUrl: customRedirects.destinationUrl,
      })
      .from(customRedirects)
      .innerJoin(organization, eq(organization.id, customRedirects.workspaceId))
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(customRedirects.slug, redirectSlug),
          isNull(customRedirects.archivedAt),
        ),
      )
      .get();
    return row ?? null;
  }

  public async countClick(id: string): Promise<void> {
    await this.database.orm
      .update(customRedirects)
      .set({ clickCount: sql`${customRedirects.clickCount} + 1` })
      .where(eq(customRedirects.id, id))
      .run();
  }

  /**
   * Site tracking hands out a visitor id and links it to a contact on identify,
   * so a redirect clicked from a tracked page can name the person who clicked.
   */
  public async findContactIdByVisitor(
    workspaceId: string,
    visitorId: string,
  ): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .innerJoin(
        visitorBindings,
        and(
          eq(visitorBindings.workspaceId, contacts.workspaceId),
          eq(visitorBindings.contactId, contacts.id),
        ),
      )
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(visitorBindings.visitorId, visitorId),
          eq(contacts.status, "active"),
        ),
      )
      .get();
    return row?.id ?? null;
  }
}
