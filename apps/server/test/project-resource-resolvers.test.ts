import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { PROJECT_RESOURCE_TYPES } from "@openengage/core/projects";
import {
  createProjectResourceResolverRegistry,
  projectResourceKey,
  resolveProjectResources,
} from "@openengage/database/projects";
import {
  ProjectResourceQueryRepository,
  automations,
  createDatabase,
  customRedirects,
  emailTemplates,
  forms,
  landingPages,
  segments,
  uuidv7,
} from "@openengage/database/testing";

import { seedWorkspaceContext } from "./factory";

describe("project resource resolver registry", () => {
  it("keeps all six canonical resource types available and resolvable", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "resolver-owner", "owner");
    const database = createDatabase(env.DB);
    const now = "2026-08-20T00:00:00.000Z";
    const ids = Object.fromEntries(
      PROJECT_RESOURCE_TYPES.map((type) => [type, uuidv7()]),
    ) as Record<(typeof PROJECT_RESOURCE_TYPES)[number], string>;
    await database.orm.batch([
      database.orm.insert(automations).values({
        id: ids.automation,
        workspaceId: workspace.workspaceId,
        name: "Resolver automation",
        description: "",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }),
      database.orm.insert(emailTemplates).values({
        id: ids.email_sequence,
        workspaceId: workspace.workspaceId,
        name: "Resolver email",
        purpose: "transactional",
        draftSubject: "Subject",
        draftContent: "{}",
        createdAt: now,
        updatedAt: now,
      }),
      database.orm.insert(segments).values({
        id: ids.segment,
        workspaceId: workspace.workspaceId,
        name: "Resolver segment",
        slug: `resolver-segment-${ids.segment.slice(-8)}`,
        kind: "static",
        membershipSource: "Fixture",
        createdAt: now,
        updatedAt: now,
      }),
      database.orm.insert(forms).values({
        id: ids.form,
        workspaceId: workspace.workspaceId,
        name: "Resolver form",
        slug: `resolver-form-${ids.form.slice(-8)}`,
        definition: "{}",
        createdAt: now,
        updatedAt: now,
      }),
      database.orm.insert(landingPages).values({
        id: ids.landing_page,
        workspaceId: workspace.workspaceId,
        name: "Resolver landing page",
        slug: `resolver-page-${ids.landing_page.slice(-8)}`,
        createdAt: now,
        updatedAt: now,
      }),
      database.orm.insert(customRedirects).values({
        id: ids.redirect,
        workspaceId: workspace.workspaceId,
        name: "Resolver redirect",
        slug: `resolver-redirect-${ids.redirect.slice(-8)}`,
        destinationUrl: "https://example.com/resolver",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const links = new ProjectResourceQueryRepository(database, workspace);
    for (const type of PROJECT_RESOURCE_TYPES) {
      await expect(links.isAvailable(type, ids[type])).resolves.toBe(true);
    }
    const resolved = await resolveProjectResources(
      createProjectResourceResolverRegistry(database, workspace.workspaceId),
      PROJECT_RESOURCE_TYPES.map((resourceType) => ({
        resourceType,
        resourceId: ids[resourceType],
      })),
    );
    expect(
      PROJECT_RESOURCE_TYPES.map((type) => resolved.get(projectResourceKey(type, ids[type]))?.name),
    ).toEqual([
      "Resolver automation",
      "Resolver email",
      "Resolver segment",
      "Resolver form",
      "Resolver landing page",
      "Resolver redirect",
    ]);
  });
});
