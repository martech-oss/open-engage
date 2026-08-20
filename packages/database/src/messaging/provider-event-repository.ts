import { and, eq, isNotNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { suppressions } from "../consent/schema";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { deliveries, deliveryEvents } from "./schema";

/** Applies idempotent provider events and their delivery side effects. */
export class MessagingProviderEventRepository extends DatabaseRepository {
  public async applyCloudflareDeliveryEvent(input: {
    providerEventId: string;
    providerMessageId: string;
    type: string;
    occurredAt: string;
    metadata: string;
    status: "delivered" | "failed" | null;
    suppressionReason: "bounce" | "complaint" | "provider" | null;
  }): Promise<boolean> {
    const delivery = await this.database.orm
      .select({
        id: deliveries.id,
        workspaceId: deliveries.workspaceId,
        contactId: deliveries.contactId,
        recipient: deliveries.recipient,
      })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.provider, "cloudflare"),
          eq(deliveries.providerMessageId, input.providerMessageId),
        ),
      )
      .get();
    if (!delivery) return false;
    const now = nowIso();
    const orm = this.database.orm;
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm
        .insert(deliveryEvents)
        .values({
          id: uuidv7(),
          workspaceId: delivery.workspaceId,
          deliveryId: delivery.id,
          provider: "cloudflare",
          providerEventId: input.providerEventId,
          providerMessageId: input.providerMessageId,
          type: input.type,
          occurredAt: input.occurredAt,
          metadata: input.metadata,
          createdAt: now,
        })
        .onConflictDoNothing(),
    ];
    if (input.status) {
      statements.push(
        orm
          .update(deliveries)
          .set({ status: input.status, updatedAt: nowIso() })
          .where(eq(deliveries.id, delivery.id)),
      );
    }
    if (input.suppressionReason && (delivery.contactId || delivery.recipient)) {
      statements.push(
        orm
          .insert(suppressions)
          .values({
            id: uuidv7(),
            workspaceId: delivery.workspaceId,
            contactId: delivery.contactId,
            email: delivery.recipient,
            reason: input.suppressionReason,
            provider: "cloudflare",
            createdAt: input.occurredAt,
          })
          .onConflictDoNothing(),
      );
    }
    const results = await orm.batch(statements);
    const eventResult = results[0] as D1Result | undefined;
    return eventResult?.meta.changes === 1;
  }

  /** The contact behind a delivery, for timeline events; null when detached. */
  public async findDeliveryContactId(
    workspaceId: string,
    deliveryId: string,
  ): Promise<string | null> {
    const row = await this.database.orm
      .select({ contactId: deliveries.contactId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.workspaceId, workspaceId),
          eq(deliveries.id, deliveryId),
          isNotNull(deliveries.contactId),
        ),
      )
      .get();
    return row?.contactId ?? null;
  }
}
