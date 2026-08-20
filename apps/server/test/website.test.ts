import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { seedWorkspaceClient } from "./factory";

describe("Website center", () => {
  it("manages and publishes forms, pages, site messages, and site tracking", async () => {
    const { client, slug: workspaceSlug, workspaceId } = await seedWorkspaceClient(env.DB);
    // The hosted-form, embed, track and script endpoints are public and are not
    // part of the oRPC contract; they stay plain fetches against the worker.
    const publicCall = (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      if (!headers.has("origin")) headers.set("origin", "https://example.com");
      return exports.default.fetch(
        new Request(`http://localhost:8787${path}`, {
          ...init,
          headers,
        }),
      );
    };

    await expect(
      client.website.updateTracking({
        enabled: true,
        allowedDomains: ["https://example.com/path", "campaign.example.com"],
      }),
    ).resolves.toEqual({ ok: true });
    const trackingSettings = await client.website.getTracking();
    expect(trackingSettings).toMatchObject({
      enabled: true,
      allowedDomains: ["example.com", "campaign.example.com"],
      workspaceSlug,
    });

    const form = await client.website.createForm({
      name: "Newsletter",
      slug: "newsletter",
      status: "published",
      definition: {
        style: "inline",
        fields: [
          { key: "email", type: "email", required: true },
          { key: "firstName", type: "text" },
        ],
      },
      allowedDomains: ["example.com"],
      turnstileEnabled: false,
      successMessage: "登録しました。",
    });
    expect(form.id).toBeTruthy();
    const hostedForm = await publicCall(`/f/${workspaceSlug}/newsletter`, {
      headers: { origin: "" },
    });
    expect(hostedForm.status).toBe(200);
    expect(await hostedForm.text()).toContain("Newsletter");
    const formEmbed = await publicCall(`/api/public/forms/${workspaceSlug}/newsletter/embed.js`, {
      headers: { origin: "" },
    });
    expect(formEmbed.status).toBe(200);
    expect(await formEmbed.text()).toContain('style === "inline"');
    const formSubmit = await publicCall(`/f/${workspaceSlug}/newsletter`, {
      method: "POST",
      body: JSON.stringify({
        email: "visitor@example.com",
        firstName: "Visitor",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(formSubmit.status).toBe(202);
    const listedForms = await client.website.listForms();
    expect(listedForms).toEqual([expect.objectContaining({ id: form.id, submissionCount: 1 })]);

    const content = {
      schemaVersion: 1,
      backgroundColor: "#f4f5f7",
      contentColor: "#ffffff",
      width: 720,
      blocks: [
        {
          id: "hero",
          type: "text",
          html: "<h1>Welcome</h1><p>Join us.</p>",
        },
      ],
    } as const;
    const page = await client.website.createPage({
      name: "Welcome page",
      slug: "welcome",
      status: "draft",
      content,
    });
    expect(page.id).toBeTruthy();
    await expect(
      client.website.updatePage({
        id: page.id,
        name: "Welcome page",
        slug: "welcome",
        status: "published",
        content,
      }),
    ).resolves.toMatchObject({ id: page.id });
    const hostedPage = await publicCall(`/p/${workspaceSlug}/welcome`, {
      headers: { origin: "" },
    });
    expect(hostedPage.status).toBe(200);
    expect(await hostedPage.text()).toContain("Welcome");

    const contact = await client.contacts.create({
      email: "known@example.com",
      customFields: {},
    });
    expect(contact.id).toBeTruthy();

    const message = await client.website.createMessage({
      name: "Pricing help",
      status: "published",
      headline: "Need help?",
      body: "Talk with our team.",
      ctaLabel: "Contact us",
      ctaUrl: "https://example.com/contact",
      pagePattern: "/pricing*",
      startsAt: null,
      endsAt: null,
    });
    expect(message.id).toBeTruthy();
    const visitorId = crypto.randomUUID();
    const trackResponse = await publicCall(`/api/public/track/${workspaceSlug}`, {
      method: "POST",
      body: JSON.stringify({
        consent: true,
        visitorId,
        email: "known@example.com",
        type: "page_viewed",
        resourceId: "https://example.com/pricing/pro",
        properties: { title: "Pricing" },
      }),
    });
    expect(trackResponse.status).toBe(202);
    expect(await trackResponse.json()).toMatchObject({
      data: { accepted: true, identified: true, visitorId },
    });
    await expect(
      env.DB.prepare(
        "SELECT resource_type AS resourceType FROM contact_events WHERE workspace_id = ? AND contact_id = ? AND type = 'page_viewed'",
      )
        .bind(workspaceId, contact.id)
        .first(),
    ).resolves.toEqual({ resourceType: "landing_page" });
    const messages = (await (
      await publicCall(
        `/api/public/site-messages/${workspaceSlug}?visitorId=${visitorId}` +
          `&url=${encodeURIComponent("https://example.com/pricing/pro")}`,
      )
    ).json()) as { data: Array<{ id: string }> };
    expect(messages.data).toEqual([expect.objectContaining({ id: message.id })]);
    expect(
      (
        await publicCall(`/api/public/site-messages/${workspaceSlug}/${message.id}/events`, {
          method: "POST",
          body: JSON.stringify({ visitorId, type: "impression" }),
        })
      ).status,
    ).toBe(202);
    const siteMessages = await client.website.listMessages();
    expect(siteMessages).toEqual([expect.objectContaining({ id: message.id, impressionCount: 1 })]);

    const tracking = await client.website.getTracking();
    expect(tracking.summary).toMatchObject({
      pageViews: 1,
      identifiedContacts: 1,
    });
    expect(tracking.topPages).toEqual([
      {
        url: "https://example.com/pricing/pro",
        views: 1,
      },
    ]);
    const script = await publicCall(`/api/public/site-tracking/${workspaceSlug}/script.js`, {
      headers: { origin: "" },
    });
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("application/javascript");
    expect(await script.text()).toContain("window.openengage");
  });
});
