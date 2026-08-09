import { desc, eq } from "drizzle-orm";

import { stringArraySchema } from "@openengage/core/shared";
import type { WebhookEndpointRow } from "@openengage/core/workspaces";

import { organization } from "../auth/schema";
import { nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { webhookEndpoints } from "./schema";

const eventTypesCodec = defineJsonCodec(stringArraySchema, "webhook_endpoints.event_types");

export interface WorkspaceDetailsRow {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  createdAt: Date;
}

/** Workspace profile and webhook endpoint persistence. */
export class WorkspaceSettingsRepository extends WorkspaceRepository {
  public async getWorkspace(): Promise<WorkspaceDetailsRow | null> {
    const row = await this.database.orm.query.organization.findFirst({
      columns: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        timezone: true,
        createdAt: true,
      },
      where: eq(organization.id, this.context.workspaceId),
    });
    return row ?? null;
  }

  public async listWebhookEndpoints(): Promise<WebhookEndpointRow[]> {
    const rows = await this.database.orm
      .select()
      .from(webhookEndpoints)
      .where(this.inWorkspace(webhookEndpoints))
      .orderBy(desc(webhookEndpoints.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      eventTypes: decodeEventTypes(row.eventTypes),
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  public async createWebhookEndpoint(input: {
    name: string;
    url: string;
    encryptedSecret: string;
    eventTypes: string[];
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(webhookEndpoints).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      url: input.url,
      encryptedSecret: input.encryptedSecret,
      eventTypes: eventTypesCodec.encode(input.eventTypes),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }
}

/** Preserve the previous read-path fallback for legacy or manually edited rows. */
function decodeEventTypes(value: string): string[] {
  try {
    const result = stringArraySchema.safeParse(JSON.parse(value));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
