import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { automationDefinitionSchema } from "@openengage/core/automations";
import { automations, createDatabase } from "@openengage/database/testing";

import { seedWorkspaceClient } from "./factory";

function definition(source: "batch" | "contact_created") {
  return automationDefinitionSchema.parse({
    name: "Published run metadata",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config:
          source === "batch"
            ? {
                source: "batch",
                reentry: "once",
                schedule: { kind: "now" },
                audience: {
                  kind: "filter",
                  filter: { kind: "condition", field: "score", operator: "gte", value: 0 },
                },
              }
            : { source: "contact_created", reentry: "once" },
      },
    ],
    edges: [],
  });
}

describe("automation draft published run metadata", () => {
  it.each([
    { published: "batch", draft: "contact_created" },
    { published: "contact_created", draft: "batch" },
  ] as const)(
    "preserves published $published metadata while editing $draft",
    async ({ published, draft }) => {
      const { client } = await seedWorkspaceClient(env.DB);
      const { id } = await client.automations.create(definition(published));
      const version = await client.automations.publish({ id });
      await client.automations.saveDraft({ id, ...definition(draft) });
      expect(await client.automations.getDraft({ id })).toMatchObject({
        graph: definition(draft),
        status: "active",
        publishedTriggerSource: published,
      });
      const preview = await client.automations.previewRun({ id }).catch((error: Error) => ({
        error: error.message,
      }));
      expect(preview).toMatchObject(
        published === "batch"
          ? { versionId: version.publishedVersionId }
          : { error: "バッチ開始のフローを選択してください" },
      );
      await client.automations.publish({ id });
      expect(await client.automations.getDraft({ id })).toMatchObject({
        publishedTriggerSource: draft,
      });
    },
  );

  it("returns no published source before publication even for an active batch draft", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const { id } = await client.automations.create(definition("batch"));
    expect(await client.automations.getDraft({ id })).toMatchObject({
      status: "draft",
      publishedTriggerSource: null,
    });
    await createDatabase(env.DB)
      .orm.update(automations)
      .set({ status: "active" })
      .where(eq(automations.id, id));
    expect(await client.automations.getDraft({ id })).toMatchObject({
      status: "active",
      publishedTriggerSource: null,
    });
    await expect(client.automations.previewRun({ id })).rejects.toThrow(/公開中/);
  });

  it("keeps published metadata across pause and resume and scopes it to the workspace", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const foreign = await seedWorkspaceClient(env.DB);
    const { id } = await client.automations.create(definition("batch"));
    await client.automations.publish({ id });
    await client.automations.saveDraft({ id, ...definition("contact_created") });
    await client.automations.setStatus({ id, status: "paused" });
    expect(await client.automations.getDraft({ id })).toMatchObject({
      status: "paused",
      publishedTriggerSource: "batch",
    });
    await expect(client.automations.previewRun({ id })).rejects.toThrow(/公開中/);
    await client.automations.setStatus({ id, status: "active" });
    expect(await client.automations.getDraft({ id })).toMatchObject({
      status: "active",
      publishedTriggerSource: "batch",
    });
    await expect(foreign.client.automations.getDraft({ id })).rejects.toThrow(/見つかりません/);
  });
});
