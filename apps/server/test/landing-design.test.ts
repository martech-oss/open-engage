import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { createDatabase } from "@openengage/database/client";

import type { RuntimeEnv } from "../src/env";
import { processLandingGeneration } from "../src/web/landing-generation-service";
import { publishLandingPage } from "../src/web/landing-publication-service";
import { seedWorkspaceClient } from "./factory";

const post = (path: string, body: unknown) =>
  exports.default.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify(body),
    }),
  );

describe("AI landing pages", () => {
  it("keeps live pages pinned, accepts their form snapshot, and rolls back atomically", async () => {
    const { client, slug, workspaceId } = await seedWorkspaceClient(env.DB);
    const document = {
      ...emptyLandingPageDocument("相談ページ"),
      html: '<main><h1>相談</h1><div data-oe-form="inquiry"></div><a data-oe-cta="contact"></a></main>',
      forms: [
        {
          refId: "inquiry",
          name: "相談",
          definition: {
            progressiveMaxFields: 3,
            fields: [
              {
                key: "email",
                kind: "standard" as const,
                type: "email" as const,
                required: true,
                progressive: false,
              },
            ],
          },
          successMessage: "受付完了",
          turnstileEnabled: false,
        },
      ],
      ctas: [{ refId: "contact", href: "https://example.com", label: "詳しく" }],
    };
    const page = await client.website.createPage({
      name: "相談ページ",
      slug: "inquiry",
      status: "draft",
      document,
    });
    await client.website.publishPage({
      id: page.id,
      versionId: page.versionId,
      baseVersionId: page.versionId,
    });
    const resolve = await post(`/api/public/landing/${slug}/inquiry/resolve`, { consent: true });
    expect(resolve.status).toBe(200);
    const data = (
      (await resolve.json()) as {
        data: { html: string; visitorToken: string; measurementToken: string };
      }
    ).data;
    expect(data.html).toContain('data-oe-form="inquiry"');
    const design = await client.website.getPageDesign({ id: page.id });
    const binding = design.versions[0]!.formBindings[0]!;
    // Editing the mutable form cannot change the snapshot pinned by the public page.
    await env.DB.prepare("UPDATE forms SET definition = ? WHERE id = ?")
      .bind(
        JSON.stringify({ fields: [{ key: "phone", required: true }], progressiveMaxFields: 3 }),
        binding.formId,
      )
      .run();
    await client.website.archiveForm({ id: binding.formId });
    await env.DB.prepare("UPDATE forms SET turnstile_enabled=1 WHERE id=?")
      .bind(binding.formId)
      .run();
    const formUrl = `http://localhost:8787/f/${slug}/lp-${binding.formId}`;
    expect((await exports.default.fetch(new Request(formUrl))).status).toBe(404);
    const pinnedUrl = new URL(formUrl);
    pinnedUrl.searchParams.set("measurementToken", data.measurementToken);
    expect((await exports.default.fetch(new Request(pinnedUrl))).status).toBe(200);
    expect(
      (
        await post(`/f/${slug}/lp-${binding.formId}/fields`, {
          email: "landing@example.com",
          consent: true,
          visitorToken: data.visitorToken,
          measurementToken: data.measurementToken,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`/f/${slug}/lp-${binding.formId}`, {
          email: "denied@example.com",
          idempotencyKey: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
    const submitted = await post(`/f/${slug}/lp-${binding.formId}`, {
      email: "landing@example.com",
      consent: true,
      oe_v: data.visitorToken,
      measurementToken: data.measurementToken,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(submitted.status).toBe(202);
    const event = await env.DB.prepare(
      "SELECT properties FROM contact_events WHERE workspace_id=? AND type='form_submitted'",
    )
      .bind(workspaceId)
      .first<{ properties: string }>();
    expect(JSON.parse(event!.properties)).toMatchObject({
      pageId: page.id,
      pageVersionId: page.versionId,
      formId: binding.formId,
      formVersionId: binding.formVersionId,
    });
    const next = await client.website.updatePage({
      id: page.id,
      name: "相談ページ",
      slug: "inquiry",
      status: "published",
      baseVersionId: page.versionId,
      document: { ...document, title: "新版" },
    });
    expect(
      (await client.website.getPageDesign({ id: page.id })).versions[0]?.publishedAt,
    ).toBeNull();
    expect((await client.website.listPages())[0]?.publishedVersionId).toBe(page.versionId);
    await expect(
      client.website.publishPage({
        id: page.id,
        versionId: next.versionId,
        baseVersionId: page.versionId,
      }),
    ).rejects.toMatchObject({ code: "PAGE_CONFLICT" });
    await client.website.publishPage({
      id: page.id,
      versionId: next.versionId,
      baseVersionId: next.versionId,
    });
    const newerBinding = (await client.website.getPageDesign({ id: page.id })).versions[0]!
      .formBindings[0]!;
    expect(
      (
        await exports.default.fetch(
          new Request(`http://localhost:8787/f/${slug}/lp-${newerBinding.formId}`),
        )
      ).status,
    ).toBe(200);
    await client.website.publishPage({
      id: page.id,
      versionId: page.versionId,
      baseVersionId: next.versionId,
    });
    expect((await client.website.listPages())[0]?.publishedVersionId).toBe(page.versionId);
    expect((await client.website.getPageDesign({ id: page.id })).previewHtml).not.toContain(
      "/api/public/landing/events",
    );
  });

  it("persists asynchronous requests, preserves valid drafts on failure, and rejects stale generated results", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const page = await client.website.createPage({
      name: "AI",
      status: "draft",
      document: emptyLandingPageDocument(),
    });
    const request = {
      pageId: page.id,
      baseVersionId: page.versionId,
      prompt: "見出しを改善",
      requestKey: crypto.randomUUID(),
    };
    const first = await client.website.generatePage(request);
    expect((await client.website.generatePage(request)).id).toBe(first.id);
    await processLandingGeneration(first.id, env as unknown as RuntimeEnv, async () => {
      throw new Error("Provider unavailable");
    });
    expect((await client.website.getPageDesign({ id: page.id })).jobs[0]?.status).toBe("failed");
    expect((await client.website.getPageDesign({ id: page.id })).currentVersionId).toBe(
      page.versionId,
    );
    const second = await client.website.generatePage({
      ...request,
      requestKey: crypto.randomUUID(),
    });
    let latest = "";
    await processLandingGeneration(second.id, env as unknown as RuntimeEnv, async () => {
      const result = await client.website.updatePage({
        id: page.id,
        name: "AI",
        slug: "ai",
        status: "draft",
        baseVersionId: page.versionId,
        document: emptyLandingPageDocument("人が編集した版"),
      });
      latest = result.versionId;
      return {
        document: emptyLandingPageDocument("古い生成結果"),
        explanation: "更新",
        imageRequests: [],
      };
    });
    const state = await client.website.getPageDesign({ id: page.id });
    expect(state.currentVersionId).toBe(latest);
    expect(state.jobs.find((job) => job.id === second.id)?.status).toBe("conflict");
    const third = await client.website.generatePage({
      ...request,
      baseVersionId: latest,
      requestKey: crypto.randomUUID(),
    });
    await processLandingGeneration(third.id, env as unknown as RuntimeEnv, async () => ({
      document: emptyLandingPageDocument("生成成功"),
      explanation: "タイトルを改善しました",
      imageRequests: [],
    }));
    const complete = await client.website.getPageDesign({ id: page.id });
    expect(complete.jobs.find((job) => job.id === third.id)?.status).toBe("completed");
    expect(complete.versions[0]?.document.title).toBe("生成成功");
  });

  it("rejects managed references outside the workspace and unsafe CSS before publication", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    await expect(
      client.website.createPage({
        name: "Invalid",
        document: {
          ...emptyLandingPageDocument(),
          measurement: { projectId: "foreign-project", primaryConversion: "form_submitted" },
        },
      }),
    ).rejects.toMatchObject({ code: "PAGE_INVALID" });
    await expect(
      client.website.createPage({
        name: "Invalid",
        document: {
          ...emptyLandingPageDocument(),
          css: "body{background:url(https://external.test/track)}",
        },
      }),
    ).rejects.toMatchObject({ code: "PAGE_INVALID" });
  });

  it("commits the generated version and job receipt together when the worker loses the commit response", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const page = await client.website.createPage({
      name: "Durable",
      document: emptyLandingPageDocument(),
    });
    const job = await client.website.generatePage({
      pageId: page.id,
      baseVersionId: page.versionId,
      prompt: "新しい下書き",
      requestKey: crypto.randomUUID(),
    });
    let interrupted = false;
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            if (statements.length === 3 && !interrupted) {
              interrupted = true;
              throw new Error("Response lost after atomic commit");
            }
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await processLandingGeneration(
      job.id,
      { ...env, DB: database } as unknown as RuntimeEnv,
      async () => ({
        document: emptyLandingPageDocument("完成"),
        explanation: "完成しました",
        imageRequests: [],
      }),
    );
    const state = await client.website.getPageDesign({ id: page.id });
    expect(interrupted).toBe(true);
    expect(state.jobs[0]).toMatchObject({
      status: "completed",
      resultVersionId: state.currentVersionId,
    });
    expect(state.versions).toHaveLength(2);
    await processLandingGeneration(job.id, env as unknown as RuntimeEnv, async () => {
      throw new Error("Should not rerun");
    });
    expect((await client.website.getPageDesign({ id: page.id })).versions).toHaveLength(2);
  });

  it("keeps one immutable form snapshot under concurrent first publication", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const document = {
      ...emptyLandingPageDocument(),
      html: '<main><div data-oe-form="signup"></div></main>',
      forms: [
        {
          refId: "signup",
          name: "Signup",
          definition: { progressiveMaxFields: 3 },
          successMessage: "Thanks",
          turnstileEnabled: false,
        },
      ],
    };
    const page = await client.website.createPage({ name: "Concurrent", document });
    const input = { id: page.id, versionId: page.versionId, baseVersionId: page.versionId };
    // Pause both transactions until both callers have read the unpublished snapshot.
    let arrivals = 0,
      release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const synchronized = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (++arrivals === 2) release();
            await ready;
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const database = createDatabase(synchronized);
    const results = await Promise.allSettled([
      publishLandingPage(database, workspaceId, env as unknown as RuntimeEnv, input),
      publishLandingPage(database, workspaceId, env as unknown as RuntimeEnv, input),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const first = (await client.website.getPageDesign({ id: page.id })).versions[0]!;
    await client.website.publishPage(input);
    const repeated = (await client.website.getPageDesign({ id: page.id })).versions[0]!;
    expect(repeated.formBindings).toEqual(first.formBindings);
    expect(repeated.publishedAt).toBe(first.publishedAt);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM forms WHERE workspace_id=?")
        .bind(workspaceId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("rejects a stale generation worker after its lease has been reclaimed", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const page = await client.website.createPage({
      name: "Lease",
      document: emptyLandingPageDocument(),
    });
    const job = await client.website.generatePage({
      pageId: page.id,
      baseVersionId: page.versionId,
      prompt: "古い応答",
      requestKey: crypto.randomUUID(),
    });
    await processLandingGeneration(job.id, env as unknown as RuntimeEnv, async () => {
      await env.DB.prepare("UPDATE landing_generation_jobs SET lease_id = 'new-owner' WHERE id = ?")
        .bind(job.id)
        .run();
      return {
        document: emptyLandingPageDocument("古い応答"),
        explanation: "stale",
        imageRequests: [],
      };
    });
    const state = await client.website.getPageDesign({ id: page.id });
    expect(state.currentVersionId).toBe(page.versionId);
    expect(state.versions).toHaveLength(1);
    expect(state.jobs[0]?.status).toBe("running");
  });
});
