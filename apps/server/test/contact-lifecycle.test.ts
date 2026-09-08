import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/client";
import { LifecycleRepository } from "@openengage/database/contacts";

import { seedWorkspaceClient } from "./factory";

describe("contact lifecycle", () => {
  it("keeps the highest reached stage and records no fabricated skipped stages", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "lifecycle@example.com",
      customFields: {},
    });
    const lifecycle = new LifecycleRepository(createDatabase(env.DB), { workspaceId });
    await lifecycle.advance(contact.id, "customer", "2026-09-08T01:00:00.000Z", "deal:won");
    await lifecycle.advance(contact.id, "customer", "2026-09-08T02:00:00.000Z", "deal:retry");
    const entries = await lifecycle.list(contact.id);
    expect(entries.map((entry) => entry.stage)).toEqual(["customer"]);
    expect(entries[0]?.reachedAt).toBe("2026-09-08T01:00:00.000Z");
    await lifecycle.advance(contact.id, "mql", "2026-09-08T03:00:00.000Z", "handoff:later");
    const row = await env.DB.prepare("SELECT lifecycle_stage FROM contacts WHERE id = ?")
      .bind(contact.id)
      .first();
    expect(row).toEqual({ lifecycle_stage: "customer" });
  });

  it("advances on real deal creation and won updates without regressing after loss", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "deal-lifecycle@example.com",
      customFields: {},
    });
    const options = await client.deals.options();
    const pipeline = options.pipelines[0]!;
    const deal = await client.deals.create({
      name: "New opportunity",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      contactId: contact.id,
      value: 500,
      currency: "JPY",
      status: "open",
      description: "",
    });
    const lifecycle = new LifecycleRepository(createDatabase(env.DB), { workspaceId });
    expect((await lifecycle.list(contact.id)).map((entry) => entry.stage)).toEqual(["sql"]);
    await client.deals.update({ id: deal.id, status: "won" });
    await client.deals.update({ id: deal.id, status: "lost" });
    expect((await lifecycle.list(contact.id)).map((entry) => entry.stage)).toEqual([
      "sql",
      "customer",
    ]);
    expect(
      await env.DB.prepare("SELECT lifecycle_stage FROM contacts WHERE id = ?")
        .bind(contact.id)
        .first(),
    ).toEqual({ lifecycle_stage: "customer" });
  });

  it("does not mutate a contact in another workspace", async () => {
    const first = await seedWorkspaceClient(env.DB);
    const second = await seedWorkspaceClient(env.DB);
    const contact = await first.client.contacts.create({
      email: "scoped@example.com",
      customFields: {},
    });
    await new LifecycleRepository(createDatabase(env.DB), {
      workspaceId: second.workspaceId,
    }).advance(contact.id, "mql");
    expect(
      await env.DB.prepare("SELECT lifecycle_stage FROM contacts WHERE id = ?")
        .bind(contact.id)
        .first(),
    ).toEqual({ lifecycle_stage: "lead" });
  });
});
