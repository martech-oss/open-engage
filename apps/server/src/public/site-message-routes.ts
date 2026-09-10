import type { Hono } from "hono";
import * as z from "zod";

import { WebRepository } from "@openengage/database/web";

import type { AppEnvironment } from "../env";
import { processPendingPublicFormEvent } from "../runtime/contact-event-service";
import { originAllowed, pagePatternMatches } from "../web/domain";
import { VisitorIdentityService } from "../web/visitor-identity-service";
import { safeJson } from "./http";
import { loadPublicTrackingWorkspace } from "./shared";

export function registerPublicSiteMessageRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/api/public/site-messages/:workspaceSlug", async (context) => {
    const database = context.get("database");
    const workspace = await loadPublicTrackingWorkspace(
      database,
      context.req.param("workspaceSlug"),
    );
    const visitorToken = context.req.query("visitorToken");
    context.header("Cache-Control", "private, no-store");
    const pageUrl = context.req.query("url") ?? "";
    if (!workspace) {
      return context.json({ data: [] });
    }
    const origin = context.req.header("origin");
    const parsedPageUrl = URL.parse(pageUrl);
    if (
      !parsedPageUrl ||
      !["http:", "https:"].includes(parsedPageUrl.protocol) ||
      !originAllowed(parsedPageUrl.origin, workspace.allowedDomains) ||
      (origin && (!/^https?:\/\//.test(origin) || !originAllowed(origin, workspace.allowedDomains)))
    ) {
      return context.json({ data: [] });
    }
    const repository = new WebRepository(database, { workspaceId: workspace.id });
    const visitor =
      visitorToken && context.req.query("consent") === "true"
        ? await new VisitorIdentityService(database, context.env).resolve(
            workspace.id,
            visitorToken,
          )
        : null;
    const messages = await repository.listActiveSiteMessagesForVisitor(
      new Date().toISOString(),
      Boolean(visitor?.contactId),
    );
    return context.json({
      data: messages
        .filter((message) => pagePatternMatches(pageUrl, message.pagePattern))
        .slice(0, 1)
        .map((message) => ({
          id: message.id,
          identified: Boolean(visitor?.contactId),
          audience: message.audience,
          frequency: message.frequency,
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
        visitorToken: z.string().max(2000),
        consent: z.literal(true),
        type: z.enum(["impression", "click"]),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return context.json({ data: { accepted: false } }, 202);
    const repository = new WebRepository(database, { workspaceId: workspace.id });
    const visitor = await new VisitorIdentityService(database, context.env).resolve(
      workspace.id,
      parsed.data.visitorToken,
    );
    const contactId = visitor?.contactId;
    if (!contactId) return context.json({ data: { accepted: false } }, 202);
    const messageId = context.req.param("messageId");
    const updated = await repository.incrementSiteMessageCounter(messageId, parsed.data.type);
    if (!updated) {
      return context.json({ data: { accepted: false } }, 202);
    }
    const eventId = await repository.recordSiteMessageEvent({
      contactId,
      visitorId: visitor!.id,
      messageId,
      type: parsed.data.type,
    });
    await processPendingPublicFormEvent(database, eventId, context.env.JOBS_QUEUE);
    return context.json({ data: { accepted: true } }, 202);
  });
}
