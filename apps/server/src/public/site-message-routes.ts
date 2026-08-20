import type { Hono } from "hono";
import * as z from "zod";

import { WebRepository } from "@openengage/database/web";

import { processPendingPublicFormEvent } from "../contacts/event-service";
import type { AppEnvironment } from "../env";
import { originAllowed, pagePatternMatches } from "../web/domain";
import { safeJson } from "./http";
import { loadPublicTrackingWorkspace } from "./shared";

export function registerPublicSiteMessageRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/site-messages/:workspaceSlug", async (context) => {
    const database = context.get("database");
    const workspace = await loadPublicTrackingWorkspace(
      database,
      context.req.param("workspaceSlug"),
    );
    const visitorId = context.req.query("visitorId");
    const pageUrl = context.req.query("url") ?? "";
    if (!workspace || !visitorId || !z.string().uuid().safeParse(visitorId).success) {
      return context.json({ data: [] });
    }
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return context.json({ data: [] });
    }
    const repository = new WebRepository(database, { workspaceId: workspace.id });
    const contactId = await repository.findVisitorContactId(visitorId);
    if (!contactId) return context.json({ data: [] });
    const messages = await repository.listActiveSiteMessagesForVisitor(new Date().toISOString());
    return context.json({
      data: messages
        .filter((message) => pagePatternMatches(pageUrl, message.pagePattern))
        .slice(0, 1)
        .map((message) => ({
          id: message.id,
          headline: message.headline,
          body: message.body,
          cta_label: message.ctaLabel,
          cta_url: message.ctaUrl,
          page_pattern: message.pagePattern,
        })),
    });
  });

  publicApp.post("/api/public/site-messages/:workspaceSlug/:messageId/events", async (context) => {
    const database = context.get("database");
    const workspace = await loadPublicTrackingWorkspace(
      database,
      context.req.param("workspaceSlug"),
    );
    if (!workspace) return context.json({ data: { accepted: false } }, 202);
    const origin = context.req.header("origin");
    // A distinguishable 403 here would let the embedding page fingerprint
    // workspace/origin config from what is otherwise a silent beacon.
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return context.json({ data: { accepted: false } }, 202);
    }
    const parsed = z
      .object({
        visitorId: z.string().uuid(),
        type: z.enum(["impression", "click"]),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return context.json({ data: { accepted: false } }, 202);
    const repository = new WebRepository(database, { workspaceId: workspace.id });
    const contactId = await repository.findVisitorContactId(parsed.data.visitorId);
    if (!contactId) return context.json({ data: { accepted: false } }, 202);
    const messageId = context.req.param("messageId");
    const updated = await repository.incrementSiteMessageCounter(messageId, parsed.data.type);
    if (!updated) {
      return context.json({ data: { accepted: false } }, 202);
    }
    const eventId = await repository.recordSiteMessageEvent({
      contactId,
      visitorId: parsed.data.visitorId,
      messageId,
      type: parsed.data.type,
    });
    await processPendingPublicFormEvent(database, eventId, context.env.JOBS_QUEUE);
    return context.json({ data: { accepted: true } }, 202);
  });
}
