import type { Hono } from "hono";
import * as z from "zod";

import { WebRepository } from "@openengage/database";

import { recordContactEvent } from "../contacts/event-service";
import type { AppEnvironment } from "../env";
import { verifySignedToken } from "../platform/crypto";
import { originAllowed } from "./domain";
import { safeJson } from "./http";
import { loadPublicTrackingWorkspace } from "./shared";
import { siteTrackingScript } from "./templates";

const transparentGif = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

export function registerPublicTrackingRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/site-tracking/:workspaceSlug/script.js", async (context) => {
    const trackingEndpoint = new URL(
      `/api/public/track/${context.req.param("workspaceSlug")}`,
      context.req.url,
    ).toString();
    const messagesEndpoint = new URL(
      `/api/public/site-messages/${context.req.param("workspaceSlug")}`,
      context.req.url,
    ).toString();
    return new Response(siteTrackingScript(trackingEndpoint, messagesEndpoint), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  publicApp.post("/api/public/track/:workspaceSlug", async (context) => {
    const database = context.get("database");
    const workspace = await loadPublicTrackingWorkspace(
      database,
      context.req.param("workspaceSlug"),
    );
    if (!workspace) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const origin = context.req.header("origin");
    // A distinguishable 403 here would let the embedding page fingerprint
    // workspace/origin config from what is otherwise a silent beacon.
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const parsed = z
      .object({
        consent: z.literal(true),
        visitorId: z.string().uuid().optional(),
        email: z.email().optional(),
        type: z.enum(["page_viewed", "custom_event"]),
        resourceId: z.string().max(2_000).optional(),
        properties: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const contactId = parsed.data.email
      ? await new WebRepository(database, { workspaceId: workspace.id }).findActiveContactIdByEmail(
          parsed.data.email.toLowerCase(),
        )
      : null;
    await recordContactEvent(database, {
      workspaceId: workspace.id,
      contactId,
      visitorId,
      type: parsed.data.type,
      resourceType: "page",
      ...(parsed.data.resourceId ? { resourceId: parsed.data.resourceId } : {}),
      properties: parsed.data.properties,
      occurredAt: now,
      queue: context.env.JOBS_QUEUE,
    });
    return context.json(
      {
        data: {
          accepted: true,
          visitorId,
          identified: Boolean(contactId),
          identityIssued: true,
        },
      },
      202,
    );
  });

  publicApp.get("/t/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "tracking",
    );
    if (payload) {
      context.executionCtx.waitUntil(
        recordContactEvent(context.get("database"), {
          workspaceId: payload.workspaceId,
          contactId: payload.contactId ?? null,
          type: "email_opened",
          resourceType: "delivery",
          resourceId: payload.resourceId,
          queue: context.env.JOBS_QUEUE,
        }).then(() => undefined),
      );
    }
    return new Response(transparentGif, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, private",
      },
    });
  });
}
