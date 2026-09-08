import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/client";
import { VisitorRepository } from "@openengage/database/contacts";
import { ContactRepository, CustomRedirectRepository } from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { VisitorIdentityService } from "../src/web/visitor-identity-service";
import { seedWorkspace } from "./factory";

const DESTINATION = "https://example.com/campaign/spring?utm_source=oe";

interface Seeded {
  workspaceId: string;
  workspaceSlug: string;
  redirectId: string;
}

async function seedRedirect(label: string, slug: string): Promise<Seeded> {
  const { workspaceId } = await seedWorkspace(env.DB);
  const workspace = await env.DB.prepare("SELECT slug FROM organization WHERE id = ?")
    .bind(workspaceId)
    .first<{ slug: string }>();
  const { id } = await new CustomRedirectRepository(env.DB, { workspaceId }).createRedirect({
    name: label,
    slug,
    destinationUrl: DESTINATION,
  });
  return { workspaceId, workspaceSlug: workspace?.slug ?? "", redirectId: id };
}

function call(path: string): Promise<Response> {
  return exports.default.fetch(new Request(`http://localhost:8787${path}`, { redirect: "manual" }));
}

async function settled<T>(read: () => Promise<T>): Promise<T> {
  await scheduler.wait(50);
  return read();
}

async function clickCount(id: string): Promise<number> {
  const row = await env.DB.prepare("SELECT click_count AS count FROM custom_redirects WHERE id = ?")
    .bind(id)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function eventCount(contactId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM contact_events WHERE contact_id = ? AND type = ?",
  )
    .bind(contactId, "custom_redirect_clicked")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("custom redirect", () => {
  it("redirects to the destination and counts an anonymous click", async () => {
    const seeded = await seedRedirect("spring", "spring");
    const response = await call(`/r/${seeded.workspaceSlug}/spring`);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DESTINATION);
    await expect(settled(() => clickCount(seeded.redirectId))).resolves.toBe(1);
  });

  it("attributes the click to the contact behind the visitor id", async () => {
    const seeded = await seedRedirect("summer", "summer");
    const contact = await new ContactRepository(env.DB, {
      workspaceId: seeded.workspaceId,
      userId: "redirect-owner",
      role: "owner",
    }).createContact({ email: "visitor@example.com", customFields: {} });
    const identity = new VisitorIdentityService(
      createDatabase(env.DB),
      env as unknown as RuntimeEnv,
    );
    const visitor = await identity.ensure(seeded.workspaceId, undefined);
    await new VisitorRepository(env.DB).bind(seeded.workspaceId, visitor.id, contact.id);
    const token = await identity.token(seeded.workspaceId, visitor.id);
    const response = await call(
      `/r/${seeded.workspaceSlug}/summer?consent=true&oe_v=${encodeURIComponent(token)}`,
    );
    expect(response.status).toBe(302);
    await expect(settled(() => eventCount(contact.id))).resolves.toBe(1);
    await expect(clickCount(seeded.redirectId)).resolves.toBe(1);
  });

  it("still counts the click when the visitor id matches no contact", async () => {
    const seeded = await seedRedirect("autumn", "autumn");
    const response = await call(`/r/${seeded.workspaceSlug}/autumn?oe_v=nobody`);
    expect(response.status).toBe(302);
    await expect(settled(() => clickCount(seeded.redirectId))).resolves.toBe(1);
  });

  it("404s for an unknown slug and for an archived link", async () => {
    const seeded = await seedRedirect("winter", "winter");
    expect((await call(`/r/${seeded.workspaceSlug}/missing`)).status).toBe(404);

    await new CustomRedirectRepository(env.DB, {
      workspaceId: seeded.workspaceId,
    }).archiveRedirect(seeded.redirectId);
    expect((await call(`/r/${seeded.workspaceSlug}/winter`)).status).toBe(404);
  });

  it("keeps slugs unique per workspace", async () => {
    const seeded = await seedRedirect("dup", "dup");
    const repository = new CustomRedirectRepository(env.DB, { workspaceId: seeded.workspaceId });
    await expect(
      repository.createRedirect({ name: "again", slug: "dup", destinationUrl: DESTINATION }),
    ).rejects.toThrow();

    // A different workspace may reuse the slug.
    const other = await seedWorkspace(env.DB);
    await expect(
      new CustomRedirectRepository(env.DB, { workspaceId: other.workspaceId }).createRedirect({
        name: "other",
        slug: "dup",
        destinationUrl: DESTINATION,
      }),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });
});
