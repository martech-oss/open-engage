import { and, eq } from "drizzle-orm";

import type { EmailTrackingSettings, EmailTrackingSettingsWrite } from "@openengage/core/messaging";

import { didChange, nowIso } from "../shared/database-utils";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { deliveries, deliveryEvents, emailTrackingSettings } from "./schema";

/** A workspace that never opted in reads as both toggles off. */
const TRACKING_DEFAULTS: EmailTrackingSettings = {
  openTrackingEnabled: false,
  clickTrackingEnabled: false,
  updatedAt: null,
};

/** Open/click toggles, read and written from the authenticated settings API. */
export class EmailTrackingSettingsRepository extends WorkspaceRepository {
  public async getSettings(): Promise<EmailTrackingSettings> {
    const row = await this.database.orm
      .select({
        openTrackingEnabled: emailTrackingSettings.openTrackingEnabled,
        clickTrackingEnabled: emailTrackingSettings.clickTrackingEnabled,
        updatedAt: emailTrackingSettings.updatedAt,
      })
      .from(emailTrackingSettings)
      .where(this.inWorkspace(emailTrackingSettings))
      .get();
    return row ?? TRACKING_DEFAULTS;
  }

  public async updateSettings(input: EmailTrackingSettingsWrite): Promise<void> {
    const now = nowIso();
    await this.database.orm
      .insert(emailTrackingSettings)
      .values({
        workspaceId: this.context.workspaceId,
        openTrackingEnabled: input.openTrackingEnabled,
        clickTrackingEnabled: input.clickTrackingEnabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: emailTrackingSettings.workspaceId,
        set: {
          openTrackingEnabled: input.openTrackingEnabled,
          clickTrackingEnabled: input.clickTrackingEnabled,
          updatedAt: now,
        },
      });
  }
}

export interface TrackingEventResult {
  /** False when this open/click was already recorded, so callers can skip the contact event. */
  inserted: boolean;
  contactId: string | null;
}

/**
 * Writes the open/click rows the public pixel and redirect endpoints produce.
 * Unauthenticated callers reach these, so every method takes the workspace id
 * from the verified token rather than a session.
 */
export class EmailTrackingEventRepository extends DatabaseRepository {
  public async readSettings(workspaceId: string): Promise<EmailTrackingSettings> {
    const row = await this.database.orm
      .select({
        openTrackingEnabled: emailTrackingSettings.openTrackingEnabled,
        clickTrackingEnabled: emailTrackingSettings.clickTrackingEnabled,
        updatedAt: emailTrackingSettings.updatedAt,
      })
      .from(emailTrackingSettings)
      .where(eq(emailTrackingSettings.workspaceId, workspaceId))
      .get();
    return row ?? TRACKING_DEFAULTS;
  }

  /**
   * Records one open or click against a delivery. Deduplication rides the
   * existing `(workspace_id, provider, provider_event_id)` unique index:
   * opens collapse to the first one per delivery, clicks to the first per
   * destination. Without it, Apple Mail Privacy Protection prefetches and
   * corporate link scanners would multiply both tables without adding signal.
   */
  public async recordTrackingEvent(input: {
    workspaceId: string;
    deliveryId: string;
    type: "opened" | "clicked";
    occurredAt: string;
    providerEventId: string;
    url?: string;
  }): Promise<TrackingEventResult | null> {
    const delivery = await this.database.orm
      .select({ contactId: deliveries.contactId })
      .from(deliveries)
      .where(
        and(eq(deliveries.id, input.deliveryId), eq(deliveries.workspaceId, input.workspaceId)),
      )
      .get();
    if (!delivery) return null;
    const result = await this.database.orm
      .insert(deliveryEvents)
      .values({
        id: uuidv7(),
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        provider: "cloudflare",
        providerEventId: input.providerEventId,
        type: input.type,
        occurredAt: input.occurredAt,
        metadata: JSON.stringify(input.url ? { url: input.url } : {}),
        createdAt: nowIso(),
      })
      .onConflictDoNothing()
      .run();
    return { inserted: didChange(result), contactId: delivery.contactId };
  }
}
