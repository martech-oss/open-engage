import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { createDatabase } from "@openengage/database/client";

import { selectLandingOptimization } from "../src/web/optimization-service";
import { seedWorkspaceClient } from "./factory";

it("uses the first matching rule while keeping anonymous fallback and workspace boundaries", async () => {
  const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
  const contact = await client.contacts.create({
    email: "personalized@example.com",
    customFields: {},
  });
  const segments = [];
  for (let i = 0; i < 2; i++)
    segments.push(
      await client.segments.create({
        name: `Audience ${i}`,
        slug: `audience-${i}`,
        kind: "dynamic",
        filter: { kind: "condition", field: "email", operator: "eq", value: contact.email },
      }),
    );
  const document = {
    ...emptyLandingPageDocument(),
    html: '<main><div data-oe-dynamic="intro"></div></main>',
    dynamicSlots: [{ refId: "intro", fallbackHtml: "<p>Original fallback</p>" }],
  };
  const page = await client.website.createPage({
    name: "Personalization",
    slug: "personalization",
    status: "draft",
    document,
  });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  await client.website.saveDynamicContent({
    pageId: page.id,
    slotId: "intro",
    fallbackHtml: "<p>Saved fallback</p>",
    rules: [
      { id: "later", segmentId: segments[0]!.id, priority: 20, html: "<p>Lower priority</p>" },
      {
        id: "first",
        segmentId: segments[1]!.id,
        priority: 10,
        html: "<p>Priority audience</p><script>alert(1)</script>",
      },
    ],
  });
  const db = createDatabase(env.DB),
    input = {
      workspaceId,
      pageId: page.id,
      defaultVersionId: page.versionId,
      visitorId: crypto.randomUUID(),
      contactId: contact.id,
    };
  expect((await selectLandingOptimization(db, input)).dynamicContents.intro).toBe(
    "<p>Priority audience</p>",
  );
  expect(
    (await selectLandingOptimization(db, { ...input, contactId: null })).dynamicContents.intro,
  ).toBe("<p>Saved fallback</p>");
  const response = await exports.default.fetch(
    new Request(`http://localhost:8787/p/${slug}/personalization`),
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const html = await response.text();
  expect(html).toContain("Saved fallback");
  expect(html).not.toContain("Priority audience");
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM site_visitors WHERE workspace_id=?")
      .bind(workspaceId)
      .first(),
  ).toEqual({ n: 0 });
  const other = await seedWorkspaceClient(env.DB);
  const foreign = await other.client.segments.create({
    name: "Foreign",
    slug: "foreign",
    kind: "static",
  });
  await expect(
    client.website.saveDynamicContent({
      pageId: page.id,
      slotId: "intro",
      fallbackHtml: "",
      rules: [{ id: "bad", segmentId: foreign.id, priority: 1, html: "foreign" }],
    }),
  ).rejects.toThrow();
  await client.contacts.archive({ id: contact.id });
  expect((await selectLandingOptimization(db, input)).dynamicContents.intro).toBe(
    "<p>Saved fallback</p>",
  );
});

it("permits one running experiment and preserves publication on a stale winner request", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const page = await client.website.createPage({
    name: "Concurrent",
    slug: "concurrent",
    status: "draft",
    document: emptyLandingPageDocument(),
  });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const second = await client.website.updatePage({
    id: page.id,
    name: "Concurrent",
    slug: "concurrent",
    status: "draft",
    baseVersionId: page.versionId,
    document: emptyLandingPageDocument("B"),
  });
  await client.website.publishPage({
    id: page.id,
    versionId: second.versionId,
    baseVersionId: second.versionId,
  });
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of ids)
    await client.website.createExperiment({
      id,
      pageId: page.id,
      name: id,
      variants: [
        { id: "a", name: "A", pageVersionId: page.versionId, weight: 50 },
        { id: "b", name: "B", pageVersionId: second.versionId, weight: 50 },
      ],
    });
  const starts = await Promise.allSettled(ids.map((id) => client.website.startExperiment({ id })));
  expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const running = ids[starts.findIndex((result) => result.status === "fulfilled")]!;
  await expect(
    client.website.endExperiment({
      id: running,
      winnerVariantId: "a",
      expectedPublishedVersionId: page.versionId,
    }),
  ).rejects.toThrow();
  expect(
    await env.DB.prepare("SELECT status FROM landing_experiments WHERE workspace_id=? AND id=?")
      .bind(workspaceId, running)
      .first(),
  ).toEqual({ status: "running" });
  expect((await client.website.getPageDesign({ id: page.id })).publishedVersionId).toBe(
    second.versionId,
  );
  const endings = await Promise.allSettled(
    ["a", null].map((winnerVariantId) =>
      client.website.endExperiment({
        id: running,
        winnerVariantId,
        expectedPublishedVersionId: second.versionId,
      }),
    ),
  );
  expect(endings.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const winner = endings[0]!.status === "fulfilled" ? "a" : null;
  expect(
    await env.DB.prepare("SELECT status,winner_variant_id FROM landing_experiments WHERE id=?")
      .bind(running)
      .first(),
  ).toEqual({ status: "ended", winner_variant_id: winner });
  await expect(
    client.website.endExperiment({
      id: running,
      winnerVariantId: winner,
      expectedPublishedVersionId: second.versionId,
    }),
  ).resolves.toEqual({ ok: true });
});
