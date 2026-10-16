import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { LandingPageRepository } from "@openengage/database/web";

import { seedWorkspaceClient } from "./factory";
import { interleaveBeforeBatch } from "./interleave";

it("does not revive a landing page archived while an edit was in flight", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const page = await client.website.createPage({
    name: "Launch",
    slug: "launch",
    status: "draft",
    document: emptyLandingPageDocument(),
  });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const racing = new LandingPageRepository(
    interleaveBeforeBatch(env.DB, () => client.website.archivePage({ id: page.id })),
    { workspaceId },
  );

  await expect(
    racing.updateLandingPage(page.id, {
      name: "Launch v2",
      slug: "launch",
      status: "draft",
      baseVersionId: page.versionId,
      document: emptyLandingPageDocument("Launch v2"),
    }),
  ).resolves.toEqual({ kind: "archived" });

  const stored = await env.DB.prepare(
    "SELECT status, name, current_version_id AS currentVersionId FROM landing_pages WHERE id = ?",
  )
    .bind(page.id)
    .first();
  expect(stored).toEqual({ status: "archived", name: "Launch", currentVersionId: page.versionId });
  const versions = await env.DB.prepare(
    "SELECT count(*) AS count FROM landing_page_versions WHERE page_id = ?",
  )
    .bind(page.id)
    .first<{ count: number }>();
  expect(versions?.count).toBe(1);
});
