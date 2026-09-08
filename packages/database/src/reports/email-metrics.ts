import { sql } from "drizzle-orm";

import { deliveries, deliveryEvents } from "../messaging/schema";

/** The shared population for email reports and the dashboard. */
export function emailSendPredicate(workspaceId: string) {
  return sql`${deliveries.workspaceId} = ${workspaceId}
    AND ${deliveries.channel} = 'email'
    AND ${deliveries.status} IN ('accepted', 'delivered', 'failed')`;
}

/** Delivery is historical: a later failure must not erase an arrival event. */
export function emailDeliveredPredicate() {
  return sql`(${deliveries.status} = 'delivered' OR EXISTS (
    SELECT 1 FROM ${deliveryEvents} AS arrived
    WHERE arrived.workspace_id = ${deliveries.workspaceId}
      AND arrived.delivery_id = ${deliveries.id} AND arrived.type = 'delivered'
  ))`;
}
