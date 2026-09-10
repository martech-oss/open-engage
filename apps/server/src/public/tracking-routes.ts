import type { Hono } from "hono";
import * as z from "zod";

import type { AppEnvironment } from "../env";
import { recordContactEvent } from "../runtime/contact-event-service";
import { originAllowed } from "../web/domain";
import {
  measurementSource,
  stripReservedMeasurementProperties,
  verifyMeasurementContext,
} from "../web/measurement-service";
import { VisitorIdentityService } from "../web/visitor-identity-service";
import { safeJson } from "./http";
import { loadPublicTrackingWorkspace } from "./shared";
import { siteTrackingScript } from "./templates";

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
        visitorToken: z.string().max(2000).optional(),
        identityToken: z.string().max(2000).optional(),
        measurementToken: z.string().max(12_000).optional(),
        type: z.enum(["page_viewed", "custom_event"]),
        resourceId: z.string().max(2_000).optional(),
        properties: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const identity = new VisitorIdentityService(database, context.env);
    let visitor = await identity.ensure(workspace.id, parsed.data.visitorToken);
    if (parsed.data.identityToken) {
      visitor =
        (await identity.identify(workspace.id, visitor.id, parsed.data.identityToken)) ?? visitor;
      if (visitor.contactId)
        context.executionCtx.waitUntil(
          context.env.JOBS_QUEUE.send({
            kind: "visitor_history",
            workspaceId: workspace.id,
            visitorId: visitor.id,
          }),
        );
    }
    const visitorId = visitor.id;
    const contactId = visitor.contactId;
    const now = new Date().toISOString();
    const measurement = parsed.data.measurementToken
      ? await verifyMeasurementContext(database, context.env, parsed.data.measurementToken, {
          workspaceId: workspace.id,
          visitorId,
        })
      : null;
    if (parsed.data.measurementToken && !measurement)
      return context.json({ data: { accepted: false } }, 202);
    await recordContactEvent(database, {
      workspaceId: workspace.id,
      contactId,
      visitorId,
      type: parsed.data.type,
      resourceType: "landing_page",
      ...(measurement
        ? { resourceId: measurement.properties.pageId }
        : parsed.data.resourceId
          ? { resourceId: parsed.data.resourceId }
          : {}),
      properties: {
        ...stripReservedMeasurementProperties(parsed.data.properties),
        ...(parsed.data.type === "page_viewed" && !measurement
          ? {
              source: measurementSource({
                url: parsed.data.resourceId,
                referrer: parsed.data.properties.referrer,
              }),
            }
          : {}),
        ...measurement?.properties,
      },
      occurredAt: now,
      queue: context.env.JOBS_QUEUE,
    });
    return context.json(
      {
        data: {
          accepted: true,
          visitorId,
          visitorToken: await identity.token(workspace.id, visitorId),
          identified: Boolean(contactId),
          identityIssued: true,
        },
      },
      202,
    );
  });
}
