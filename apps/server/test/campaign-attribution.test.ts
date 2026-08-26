import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ContactRepository,
  createDatabase,
  CustomRedirectRepository,
} from "@openengage/database/testing";

import { campaignReport } from "../src/reports/campaigns-report";
import { toReportRange } from "../src/reports/shared";
import { recordContactEvent } from "../src/runtime/contact-event-service";
import { seedWorkspaceClient } from "./factory";

const RANGE = toReportRange("2026-01-01", "2026-12-31");

async function seedContact(workspaceId: string, email: string): Promise<string> {
  const contact = await new ContactRepository(env.DB, {
    workspaceId,
    userId: "campaign-owner",
    role: "owner",
  }).createContact({ email, customFields: {} });
  return contact.id;
}

async function touch(
  workspaceId: string,
  contactId: string,
  resourceId: string,
  occurredAt: string,
): Promise<void> {
  await recordContactEvent(createDatabase(env.DB), {
    workspaceId,
    contactId,
    type: "custom_redirect_clicked",
    resourceType: "custom_redirect",
    resourceId,
    occurredAt,
  });
}

/** Wins a deal for `contactId` worth `value`, closed inside the report range. */
async function winDeal(
  client: Awaited<ReturnType<typeof seedWorkspaceClient>>["client"],
  contactId: string,
  value: number,
  wonAt: string,
): Promise<void> {
  const options = await client.deals.options();
  const pipeline = options.pipelines[0];
  if (!pipeline) throw new Error("seed workspace has no pipeline");
  const stage = pipeline.stages[0];
  if (!stage) throw new Error("seed pipeline has no stage");
  const deal = await client.deals.create({
    pipelineId: pipeline.id,
    stageId: stage.id,
    name: `deal-${contactId}`,
    value,
    currency: "JPY",
    contactId,
  });
  await env.DB.prepare("UPDATE deals SET status = 'won', won_at = ? WHERE id = ?")
    .bind(wonAt, deal.id)
    .run();
}

describe("campaign attribution", () => {
  it("records a touch only for resources linked to a project", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "春キャンペーン", description: "" });
    const redirects = new CustomRedirectRepository(env.DB, { workspaceId });
    const linked = await redirects.createRedirect({
      name: "広告",
      slug: "ad",
      destinationUrl: "https://example.com/a",
    });
    const unlinked = await redirects.createRedirect({
      name: "未リンク",
      slug: "loose",
      destinationUrl: "https://example.com/b",
    });
    await client.projects.addItem({
      id: project.id,
      resourceType: "redirect",
      resourceId: linked.id,
    });

    const contactId = await seedContact(workspaceId, "touch@example.com");
    await touch(workspaceId, contactId, linked.id, "2026-03-01T00:00:00.000Z");
    await touch(workspaceId, contactId, unlinked.id, "2026-03-02T00:00:00.000Z");

    const report = await campaignReport(createDatabase(env.DB), workspaceId, RANGE, "JPY");
    expect(report.campaigns).toHaveLength(1);
    expect(report.campaigns[0]).toMatchObject({
      name: "春キャンペーン",
      touches: 1,
      contacts: 1,
    });
  });

  it("credits influence to both campaigns but splits first and last touch", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const first = await client.projects.create({ name: "認知", description: "" });
    const last = await client.projects.create({ name: "商談化", description: "" });
    const redirects = new CustomRedirectRepository(env.DB, { workspaceId });
    const firstLink = await redirects.createRedirect({
      name: "認知広告",
      slug: "awareness",
      destinationUrl: "https://example.com/a",
    });
    const lastLink = await redirects.createRedirect({
      name: "デモ申込",
      slug: "demo",
      destinationUrl: "https://example.com/b",
    });
    await client.projects.addItem({
      id: first.id,
      resourceType: "redirect",
      resourceId: firstLink.id,
    });
    await client.projects.addItem({
      id: last.id,
      resourceType: "redirect",
      resourceId: lastLink.id,
    });

    const contactId = await seedContact(workspaceId, "journey@example.com");
    await touch(workspaceId, contactId, firstLink.id, "2026-03-01T00:00:00.000Z");
    await touch(workspaceId, contactId, lastLink.id, "2026-04-01T00:00:00.000Z");
    await winDeal(client, contactId, 500_000, "2026-05-01T00:00:00.000Z");

    const report = await campaignReport(createDatabase(env.DB), workspaceId, RANGE, "JPY");
    const awareness = report.campaigns.find((row) => row.name === "認知");
    const conversion = report.campaigns.find((row) => row.name === "商談化");

    // Influence credits the full amount to both; the touch models split it.
    expect(awareness).toMatchObject({
      influencedDeals: 1,
      influencedValue: 500_000,
      firstTouchValue: 500_000,
      lastTouchValue: 0,
    });
    expect(conversion).toMatchObject({
      influencedDeals: 1,
      influencedValue: 500_000,
      firstTouchValue: 0,
      lastTouchValue: 500_000,
    });
    expect(report.summary.firstTouchValue).toBe(500_000);
    expect(report.summary.lastTouchValue).toBe(500_000);
  });

  it("ignores touches that happen after the deal was won", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "後追い", description: "" });
    const link = await new CustomRedirectRepository(env.DB, { workspaceId }).createRedirect({
      name: "後追い広告",
      slug: "late",
      destinationUrl: "https://example.com/a",
    });
    await client.projects.addItem({
      id: project.id,
      resourceType: "redirect",
      resourceId: link.id,
    });

    const contactId = await seedContact(workspaceId, "late@example.com");
    await winDeal(client, contactId, 300_000, "2026-02-01T00:00:00.000Z");
    await touch(workspaceId, contactId, link.id, "2026-03-01T00:00:00.000Z");

    const report = await campaignReport(createDatabase(env.DB), workspaceId, RANGE, "JPY");
    expect(report.campaigns[0]).toMatchObject({
      touches: 1,
      influencedDeals: 0,
      influencedValue: 0,
    });
  });

  it("counts a repeated touch on the same campaign only once per deal", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "単一", description: "" });
    const link = await new CustomRedirectRepository(env.DB, { workspaceId }).createRedirect({
      name: "広告",
      slug: "repeat",
      destinationUrl: "https://example.com/a",
    });
    await client.projects.addItem({
      id: project.id,
      resourceType: "redirect",
      resourceId: link.id,
    });

    const contactId = await seedContact(workspaceId, "repeat@example.com");
    await touch(workspaceId, contactId, link.id, "2026-03-01T00:00:00.000Z");
    await touch(workspaceId, contactId, link.id, "2026-03-05T00:00:00.000Z");
    await winDeal(client, contactId, 100_000, "2026-04-01T00:00:00.000Z");

    const report = await campaignReport(createDatabase(env.DB), workspaceId, RANGE, "JPY");
    expect(report.campaigns[0]).toMatchObject({
      touches: 2,
      influencedDeals: 1,
      influencedValue: 100_000,
      firstTouchValue: 100_000,
      lastTouchValue: 100_000,
    });
  });
});
