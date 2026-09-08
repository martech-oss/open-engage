import type { Hono } from "hono";
import * as z from "zod";

import {
  LandingDesignRepository,
  OptimizationRepository,
  PublicLandingRepository,
  PublicWebRepository,
} from "@openengage/database/web";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { renderContent } from "../rendering/content-renderer";
import { recordContactEvent } from "../runtime/contact-event-service";
import { landingImageUrls } from "../web/landing-assets";
import { renderLandingPage } from "../web/landing-renderer";
import {
  issueMeasurementToken,
  measurementSource,
  verifyMeasurementContext,
} from "../web/measurement-service";
import { selectLandingOptimization } from "../web/optimization-service";
import { VisitorIdentityService } from "../web/visitor-identity-service";
import { safeJson } from "./http";

export function registerPublicLandingRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/p/:workspaceSlug/:pageSlug", async (context) => {
    const database = context.get("database"),
      workspaceSlug = context.req.param("workspaceSlug"),
      pageSlug = context.req.param("pageSlug");
    const page = await new PublicLandingRepository(database).page(workspaceSlug, pageSlug);
    if (!page?.publishedVersionId)
      return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const version = await new LandingDesignRepository(database, page).version(
      page.id,
      page.publishedVersionId,
    );
    context.header("Cache-Control", "private, no-store");
    context.header("Referrer-Policy", "no-referrer");
    if (!version) {
      const legacy = await new PublicWebRepository(database).findPublishedLandingPage(
        workspaceSlug,
        pageSlug,
      );
      if (!legacy) return apiError(context, 404, "page_not_found", "ページが見つかりません");
      return context.html(
        renderContent(legacy.contentDocument, {
          contact: {},
          workspace: { name: legacy.workspaceName },
        }).html,
      );
    }
    const origin = new URL(context.req.url).origin;
    const measurementToken = await issueMeasurementToken(
      context.env,
      page.workspaceId,
      version.id,
      {
        pageId: page.id,
        visitorId: null,
        source: measurementSource({
          url: context.req.url,
          referrer: context.req.header("referer"),
        }),
      },
    );
    const dynamic = await new OptimizationRepository(database, page).dynamic(page.id);
    return context.html(
      await renderLandingPage(version.publishedDocument ?? version.document, {
        origin,
        workspaceSlug,
        pageSlug,
        measurementToken,
        formBindings: version.formBindings,
        imageUrls: await landingImageUrls(
          database,
          page.workspaceId,
          version.document,
          origin,
          false,
        ),
        dynamicContents: Object.fromEntries(
          dynamic.map((content) => [content.slotId, content.fallbackHtml]),
        ),
        preview: false,
      }),
    );
  });
  publicApp.post("/api/public/landing/:workspaceSlug/:pageSlug/resolve", async (context) => {
    const parsed = z
      .object({
        consent: z.literal(true),
        visitorToken: z.string().max(2000).optional(),
        source: z.unknown().optional(),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return apiError(context, 422, "consent_required", "計測の同意が必要です");
    const database = context.get("database"),
      workspaceSlug = context.req.param("workspaceSlug"),
      pageSlug = context.req.param("pageSlug");
    const page = await new PublicLandingRepository(database).page(workspaceSlug, pageSlug);
    if (!page?.publishedVersionId)
      return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const identity = new VisitorIdentityService(database, context.env),
      visitor = await identity.ensure(page.workspaceId, parsed.data.visitorToken);
    const selection = await selectLandingOptimization(database, {
      workspaceId: page.workspaceId,
      pageId: page.id,
      defaultVersionId: page.publishedVersionId,
      visitorId: visitor.id,
      contactId: visitor.contactId,
    });
    const version = await new LandingDesignRepository(database, page).version(
      page.id,
      selection.pageVersionId,
    );
    if (!version?.publishedAt)
      return apiError(context, 404, "page_not_found", "公開版が見つかりません");
    const visitorToken = await identity.token(page.workspaceId, visitor.id),
      origin = new URL(context.req.url).origin;
    const measurementToken = await issueMeasurementToken(
      context.env,
      page.workspaceId,
      version.id,
      {
        pageId: page.id,
        visitorId: visitor.id,
        source: measurementSource(parsed.data.source),
        ...(selection.experimentId
          ? {
              experimentId: selection.experimentId,
              variantId: selection.variantId,
              exposureId: selection.exposureId,
            }
          : {}),
      },
    );
    const html = await renderLandingPage(version.publishedDocument ?? version.document, {
      origin,
      workspaceSlug,
      pageSlug,
      measurementToken,
      formBindings: version.formBindings,
      imageUrls: await landingImageUrls(
        database,
        page.workspaceId,
        version.document,
        origin,
        false,
      ),
      dynamicContents: selection.dynamicContents,
      preview: false,
      resolved: true,
      visitorToken,
    });
    context.header("Cache-Control", "private, no-store");
    return context.json({ data: { html, visitorToken, measurementToken } });
  });
  publicApp.post("/api/public/landing/events", async (context) => {
    const parsed = z
      .object({
        consent: z.literal(true),
        visitorToken: z.string().max(2000),
        measurementToken: z.string().max(12_000),
        type: z.enum(["page_viewed", "cta_clicked"]),
        refId: z.string().optional(),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return context.json({ data: { accepted: false } }, 202);
    const database = context.get("database");
    const measurement = await verifyMeasurementContext(
      database,
      context.env,
      parsed.data.measurementToken,
    );
    if (!measurement?.visitorId) return context.json({ data: { accepted: false } }, 202);
    const visitor = await new VisitorIdentityService(database, context.env).resolve(
      measurement.workspaceId,
      parsed.data.visitorToken,
    );
    if (!visitor || visitor.id !== measurement.visitorId)
      return context.json({ data: { accepted: false } }, 202);
    if (
      parsed.data.type === "cta_clicked" &&
      !measurement.document.ctas.some((cta) => cta.refId === parsed.data.refId)
    )
      return context.json({ data: { accepted: false } }, 202);
    const occurredAt = new Date().toISOString();
    await recordContactEvent(database, {
      workspaceId: measurement.workspaceId,
      contactId: visitor.contactId,
      visitorId: visitor.id,
      type: parsed.data.type === "cta_clicked" ? "custom_event" : "page_viewed",
      resourceType: "landing_page",
      resourceId: measurement.properties.pageId,
      properties: {
        ...measurement.properties,
        ...(parsed.data.type === "cta_clicked"
          ? { event: "cta_clicked", ctaId: parsed.data.refId }
          : {}),
      },
      occurredAt,
      queue: context.env.JOBS_QUEUE,
    });
    return context.json({ data: { accepted: true } }, 202);
  });
}
