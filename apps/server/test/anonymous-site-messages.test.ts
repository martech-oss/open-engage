import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/client";
import { WebRepository } from "@openengage/database/web";

import { seedWorkspaceClient } from "./factory";

const messageInput = {
  name: "Public help",
  status: "published" as const,
  headline: "Welcome",
  body: "Ask us",
  ctaLabel: "Contact",
  ctaUrl: "https://example.com/contact",
  pagePattern: "/pricing*",
  startsAt: null,
  endsAt: null,
};

async function fixture() {
  const workspace = await seedWorkspaceClient(env.DB);
  await workspace.client.website.updateTracking({ enabled: true, allowedDomains: ["example.com"] });
  const get = async (
    url = "https://example.com/pricing",
    origin = "https://example.com",
    extra = "",
  ) => {
    const response = await exports.default.fetch(
      new Request(
        `http://localhost:8787/api/public/site-messages/${workspace.slug}?url=${encodeURIComponent(url)}${extra}`,
        { headers: origin ? { origin } : {} },
      ),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    return (await response.json()) as {
      data: Array<{ id: string; frequency: string; audience: string }>;
    };
  };
  return { ...workspace, get };
}

describe("anonymous site messages", () => {
  it("keeps start/end boundaries inclusive and persists audience/frequency changes", async () => {
    const f = await fixture();
    const message = await f.client.website.createMessage({
      ...messageInput,
      audience: "all",
      frequency: "page",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-09-02T00:00:00.000Z",
    });
    const repository = new WebRepository(createDatabase(env.DB), { workspaceId: f.workspaceId });
    expect(await repository.listActiveSiteMessagesForVisitor("2026-08-31T23:59:59.999Z")).toEqual(
      [],
    );
    expect(
      await repository.listActiveSiteMessagesForVisitor("2026-09-01T00:00:00.000Z"),
    ).toMatchObject([{ id: message.id }]);
    expect(
      await repository.listActiveSiteMessagesForVisitor("2026-09-02T00:00:00.000Z"),
    ).toMatchObject([{ id: message.id }]);
    expect(await repository.listActiveSiteMessagesForVisitor("2026-09-02T00:00:00.001Z")).toEqual(
      [],
    );
    await f.client.website.updateMessage({
      ...messageInput,
      id: message.id,
      audience: "identified",
      frequency: "session",
    });
    expect(await f.client.website.listMessages()).toMatchObject([
      { id: message.id, audience: "identified", frequency: "session" },
    ]);
    expect((await f.get()).data).toEqual([]);
  });

  it("serves all-audience CTA without creating identity or events and preserves old defaults", async () => {
    const f = await fixture();
    const publicMessage = await f.client.website.createMessage({
      ...messageInput,
      audience: "all",
      frequency: "page",
    });
    const privateMessage = await f.client.website.createMessage({
      ...messageInput,
      name: "Private",
    });
    expect(await f.get()).toEqual({
      data: [expect.objectContaining({ id: publicMessage.id, audience: "all", frequency: "page" })],
    });
    expect(await f.get(undefined, undefined, "&consent=false&visitorToken=invalid")).toMatchObject({
      data: [{ id: publicMessage.id }],
    });
    expect(await f.client.website.listMessages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: privateMessage.id,
          audience: "identified",
          frequency: "session",
        }),
      ]),
    );
    const count = await env.DB.prepare(
      "SELECT count(*) AS count FROM contact_events WHERE workspace_id = ?",
    )
      .bind(f.workspaceId)
      .first();
    expect(count).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM site_visitors WHERE workspace_id = ?")
        .bind(f.workspaceId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM visitor_bindings WHERE workspace_id = ?")
        .bind(f.workspaceId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("enforces page URL, origin, publication, schedule and workspace boundaries", async () => {
    const f = await fixture();
    const active = await f.client.website.createMessage({ ...messageInput, audience: "all" });
    await f.client.website.createMessage({ ...messageInput, audience: "all", status: "draft" });
    await f.client.website.createMessage({
      ...messageInput,
      audience: "all",
      startsAt: "2099-01-01T00:00:00.000Z",
    });
    await f.client.website.createMessage({
      ...messageInput,
      audience: "all",
      endsAt: "2000-01-01T00:00:00.000Z",
    });
    const other = await fixture();
    await other.client.website.createMessage({ ...messageInput, audience: "all" });
    expect((await f.get()).data.map((m) => m.id)).toEqual([active.id]);
    for (const [url, origin] of [
      ["https://example.com/elsewhere", "https://example.com"],
      ["https://evil.example/pricing", "https://example.com"],
      ["https://example.com/pricing", "https://evil.example"],
      ["/pricing", "https://example.com"],
      ["javascript:alert(1)", "https://example.com"],
      ["ftp://example.com/pricing", "https://example.com"],
    ])
      expect((await f.get(url, origin)).data).toEqual([]);
    expect((await f.get("https://example.com/pricing", "")).data.map((m) => m.id)).toEqual([
      active.id,
    ]);
    await f.client.website.archiveMessage({ id: active.id });
    expect((await f.get()).data).toEqual([]);
  });

  it("never returns identified messages for missing, unconsented, or foreign identity", async () => {
    const f = await fixture();
    await f.client.website.createMessage(messageInput);
    expect((await f.get()).data).toEqual([]);
    expect((await f.get(undefined, undefined, "&consent=true&visitorToken=invalid")).data).toEqual(
      [],
    );
    const other = await fixture();
    const contact = await other.client.contacts.create({
      email: "elsewhere@example.com",
      customFields: {},
    });
    const assertion = await other.client.website.issueIdentityToken({ contactId: contact.id });
    const tracked = await exports.default.fetch(
      new Request(`http://localhost:8787/api/public/track/${other.slug}`, {
        method: "POST",
        headers: { origin: "https://example.com", "content-type": "application/json" },
        body: JSON.stringify({
          consent: true,
          identityToken: assertion.token,
          type: "page_viewed",
          resourceId: "https://example.com/pricing",
        }),
      }),
    );
    const token = ((await tracked.json()) as { data: { visitorToken: string } }).data.visitorToken;
    expect(
      (await f.get(undefined, undefined, `&consent=true&visitorToken=${encodeURIComponent(token)}`))
        .data,
    ).toEqual([]);
    expect(
      (
        await other.get(
          undefined,
          undefined,
          `&consent=false&visitorToken=${encodeURIComponent(token)}`,
        )
      ).data,
    ).toEqual([]);
  });

  it("rejects anonymous and unconsented event-only calls without counting", async () => {
    const f = await fixture();
    const message = await f.client.website.createMessage({ ...messageInput, audience: "all" });
    for (const body of [
      { type: "impression" },
      { type: "click", consent: false, visitorToken: "invalid" },
      { type: "click", consent: true, visitorToken: "invalid" },
    ]) {
      const response = await exports.default.fetch(
        new Request(
          `http://localhost:8787/api/public/site-messages/${f.slug}/${message.id}/events`,
          {
            method: "POST",
            headers: { origin: "https://example.com", "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        ),
      );
      expect(await response.json()).toEqual({ data: { accepted: false } });
    }
    expect(await f.client.website.listMessages()).toMatchObject([
      { impressionCount: 0, clickCount: 0 },
    ]);
  });
});
