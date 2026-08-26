import type { Hono } from "hono";

import { PublicCustomRedirectRepository } from "@openengage/database/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { recordContactEvent } from "../runtime/contact-event-service";

/**
 * The public side of a Custom Redirect. The URL is stable and shareable, so
 * unlike the per-delivery click redirect there is no signed token to identify
 * the visitor - attribution rides the `oe_v` visitor id that the site tracking
 * script appends, and falls back to an anonymous click.
 */
export function registerPublicCustomRedirectRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/r/:workspaceSlug/:redirectSlug", async (context) => {
    const database = context.get("database");
    const repository = new PublicCustomRedirectRepository(database);
    const redirect = await repository.findRedirect(
      context.req.param("workspaceSlug"),
      context.req.param("redirectSlug"),
    );
    if (!redirect) return apiError(context, 404, "redirect_not_found", "リンクが見つかりません");

    const visitorId = context.req.query("oe_v");
    context.executionCtx.waitUntil(
      recordRedirectClick(database, {
        redirect,
        ...(visitorId ? { visitorId } : {}),
        queue: context.env.JOBS_QUEUE,
      }),
    );
    return context.redirect(redirect.destinationUrl, 302);
  });
}

async function recordRedirectClick(
  database: Parameters<typeof recordContactEvent>[0],
  input: {
    redirect: { id: string; workspaceId: string; destinationUrl: string };
    visitorId?: string;
    queue: Queue;
  },
): Promise<void> {
  const repository = new PublicCustomRedirectRepository(database);
  await repository.countClick(input.redirect.id);
  const contactId = input.visitorId
    ? await repository.findContactIdByVisitor(input.redirect.workspaceId, input.visitorId)
    : null;
  // An anonymous click still moves the counter; only a resolved contact earns a
  // timeline entry, an automation enrollment and a score change.
  if (!contactId) return;
  await recordContactEvent(database, {
    workspaceId: input.redirect.workspaceId,
    contactId,
    ...(input.visitorId ? { visitorId: input.visitorId } : {}),
    type: "custom_redirect_clicked",
    resourceType: "custom_redirect",
    resourceId: input.redirect.id,
    properties: { url: input.redirect.destinationUrl },
    queue: input.queue,
  });
}
