import type { Hono } from "hono";

import { type OpenEngageDatabase } from "@openengage/database/client";
import { EmailTrackingEventRepository } from "@openengage/database/messaging";

import type { AppEnvironment } from "../env";
import { sha256Hex, verifySignedToken } from "../platform/crypto";
import { recordContactEvent } from "../runtime/contact-event-service";

const transparentGif = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

/**
 * The open pixel and the click redirect that {@link applyEmailTracking} points
 * at. Both are unauthenticated: the signed token is the only credential, and it
 * carries the workspace so a forged one cannot reach another tenant's rows.
 */
export function registerEmailTrackingRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/t/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "tracking",
    );
    if (payload) {
      context.executionCtx.waitUntil(
        recordEmailEngagement(context.get("database"), {
          workspaceId: payload.workspaceId,
          deliveryId: payload.resourceId,
          contactId: payload.contactId ?? null,
          type: "opened",
          providerEventId: `open:${payload.resourceId}`,
          queue: context.env.JOBS_QUEUE,
        }),
      );
    }
    return new Response(transparentGif, {
      headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, private" },
    });
  });

  publicApp.get("/c/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "click",
    );
    // verifySignedToken already rejects a click token without an http(s) url,
    // so an unverifiable token is the only way to land here without one.
    if (!payload?.url) return context.redirect(context.env.APP_URL, 302);
    const url = payload.url;
    context.executionCtx.waitUntil(
      recordEmailEngagement(context.get("database"), {
        workspaceId: payload.workspaceId,
        deliveryId: payload.resourceId,
        contactId: payload.contactId ?? null,
        type: "clicked",
        providerEventId: `click:${payload.resourceId}:${(await sha256Hex(url)).slice(0, 32)}`,
        url,
        queue: context.env.JOBS_QUEUE,
      }),
    );
    return context.redirect(url, 302);
  });
}

/**
 * Writes the delivery event that feeds the email report, then - only when that
 * insert was the first of its kind - the contact event that decision nodes,
 * segments and scoring read. Skipping the contact event on a duplicate keeps
 * mailbox prefetches and link scanners from flooding the timeline.
 */
async function recordEmailEngagement(
  database: OpenEngageDatabase,
  input: {
    workspaceId: string;
    deliveryId: string;
    contactId: string | null;
    type: "opened" | "clicked";
    providerEventId: string;
    url?: string;
    queue: Queue;
  },
): Promise<void> {
  const occurredAt = new Date().toISOString();
  const result = await new EmailTrackingEventRepository(database).recordTrackingEvent({
    workspaceId: input.workspaceId,
    deliveryId: input.deliveryId,
    type: input.type,
    occurredAt,
    providerEventId: input.providerEventId,
    ...(input.url ? { url: input.url } : {}),
  });
  if (!result?.inserted) return;
  const contactId = input.contactId ?? result.contactId;
  if (!contactId) return;
  await recordContactEvent(database, {
    workspaceId: input.workspaceId,
    contactId,
    type: input.type === "opened" ? "email_opened" : "email_clicked",
    resourceType: "delivery",
    resourceId: input.deliveryId,
    ...(input.url ? { properties: { url: input.url } } : {}),
    occurredAt,
    queue: input.queue,
  });
}
