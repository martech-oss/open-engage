import type { Hono } from "hono";

import { PublicCustomRedirectRepository } from "@openengage/database/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { recordContactEvent } from "../runtime/contact-event-service";
import { VisitorIdentityService } from "../web/visitor-identity-service";

export function registerPublicCustomRedirectRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/r/:workspaceSlug/:redirectSlug", async (context) => {
    const database = context.get("database");
    const repository = new PublicCustomRedirectRepository(database);
    const redirect = await repository.findRedirect(
      context.req.param("workspaceSlug"),
      context.req.param("redirectSlug"),
    );
    if (!redirect) return apiError(context, 404, "redirect_not_found", "リンクが見つかりません");

    const visitor =
      context.req.query("consent") === "true"
        ? await new VisitorIdentityService(database, context.env).resolve(
            redirect.workspaceId,
            context.req.query("oe_v"),
          )
        : null;
    context.header("Cache-Control", "private, no-store");
    context.header("Referrer-Policy", "no-referrer");
    context.executionCtx.waitUntil(
      recordRedirectClick(database, {
        redirect,
        ...(visitor ? { visitorId: visitor.id, contactId: visitor.contactId } : {}),
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
    contactId?: string | null;
    queue: Queue;
  },
): Promise<void> {
  const repository = new PublicCustomRedirectRepository(database);
  await repository.countClick(input.redirect.id);
  if (!input.visitorId) return;
  const contactId = input.contactId ?? null;
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
