import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@openengage/database/testing";

import { seedMember, seedWorkspaceClient } from "./factory";

describe("Deals CRM", () => {
  it("rejects direct default demotion but allows a previous default false no-op", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const original = (await client.deals.options()).pipelines[0]!;

    await expect(
      client.deals.updatePipeline({ id: original.id, isDefault: false }),
    ).rejects.toMatchObject({ code: "DEFAULT_DEAL_PIPELINE_REQUIRED", status: 409 });

    const replacement = await client.deals.createPipeline({ name: "Replacement" });
    await client.deals.updatePipeline({ id: replacement.id, isDefault: true });
    await expect(
      client.deals.updatePipeline({ id: original.id, isDefault: false }),
    ).resolves.toMatchObject({ id: original.id, isDefault: false });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM deal_pipelines WHERE workspace_id = ? AND archived_at IS NULL AND is_default = 1",
      )
        .bind(workspaceId)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it("makes a first custom pipeline default and repairs a raw zero-default workspace", async () => {
    const first = await seedWorkspaceClient(env.DB);
    const custom = await first.client.deals.createPipeline({ name: "First custom pipeline" });
    expect(custom.isDefault).toBe(true);

    const second = await first.client.deals.createPipeline({ name: "Second pipeline" });
    const sameTime = "2026-01-01T00:00:00.000Z";
    await env.DB.prepare(
      "UPDATE deal_pipelines SET is_default = 0, created_at = ? WHERE workspace_id = ? AND archived_at IS NULL",
    )
      .bind(sameTime, first.workspaceId)
      .run();
    const expectedDefault = [custom.id, second.id].sort((left, right) =>
      left.localeCompare(right),
    )[0];

    const repaired = await first.client.deals.options();
    expect(
      repaired.pipelines.filter((pipeline) => pipeline.isDefault).map((pipeline) => pipeline.id),
    ).toEqual([expectedDefault]);
  });

  it("serializes concurrent promotions and chooses an id-stable archive fallback", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const original = (await client.deals.options()).pipelines[0]!;
    const first = await client.deals.createPipeline({ name: "First candidate" });
    const second = await client.deals.createPipeline({ name: "Second candidate" });

    const promotions = await Promise.allSettled([
      client.deals.updatePipeline({ id: first.id, isDefault: true }),
      client.deals.updatePipeline({ id: second.id, isDefault: true }),
    ]);
    expect(promotions.every((result) => result.status === "fulfilled")).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM deal_pipelines WHERE workspace_id = ? AND archived_at IS NULL AND is_default = 1",
      )
        .bind(workspaceId)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });

    await client.deals.updatePipeline({ id: original.id, isDefault: true });
    await env.DB.prepare(
      "UPDATE deal_pipelines SET created_at = ? WHERE workspace_id = ? AND id IN (?, ?)",
    )
      .bind("2026-01-01T00:00:00.000Z", workspaceId, first.id, second.id)
      .run();
    await client.deals.archivePipeline({ id: original.id });
    const expectedFallback = [first.id, second.id].sort((left, right) =>
      left.localeCompare(right),
    )[0];
    expect(
      (await client.deals.options()).pipelines.find((pipeline) => pipeline.isDefault)?.id,
    ).toBe(expectedFallback);
  });

  it("manages a deal through its pipeline and task lifecycle", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB, {
      timezone: "Asia/Tokyo",
    });
    await seedMember(env.DB, { workspaceId, userId });

    const options = await client.deals.options();
    expect(options.pipelines).toHaveLength(1);
    expect(options.pipelines[0]?.isDefault).toBe(true);
    expect(options.pipelines[0]?.stages.map((stage) => stage.name)).toEqual([
      "新規",
      "連絡済み",
      "提案",
      "交渉",
      "最終確認",
    ]);
    expect(options.members).toEqual([expect.objectContaining({ id: userId })]);

    const pipeline = options.pipelines[0]!;
    const firstStage = pipeline.stages[0]!;
    const secondStage = pipeline.stages[1]!;
    const account = await client.companies.create({
      name: "Acme株式会社",
      domain: "acme.example",
    });
    const contact = await client.contacts.create({
      email: "buyer@acme.example",
      firstName: "花子",
      lastName: "営業",
      customFields: {},
    });

    const created = await client.deals.create({
      name: "Acme MA導入",
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      value: 1_500_000,
      currency: "JPY",
      ownerUserId: userId,
      contactId: contact.id,
      companyId: account.id,
      expectedCloseDate: "2026-09-30",
      description: "提案準備中",
    });
    expect(created).toMatchObject({
      status: "open",
      stageId: firstStage.id,
      companyName: "Acme株式会社",
    });

    await expect(client.deals.move({ id: created.id, stageId: uuidv7() })).rejects.toMatchObject({
      code: "INVALID_DEAL_STAGE",
      status: 422,
    });
    await expect(
      client.deals.move({ id: created.id, stageId: secondStage.id }),
    ).resolves.toMatchObject({ stageId: secondStage.id, stageName: "連絡済み" });

    const task = await client.deals.createTask({
      dealId: created.id,
      title: "提案内容を電話で確認",
      type: "call",
      dueAt: "2026-08-01T03:00:00.000Z",
      assignedUserId: userId,
    });
    expect(task).toMatchObject({ status: "open", type: "call" });
    await expect(client.deals.listTasks({ status: "open" })).resolves.toEqual([
      expect.objectContaining({ id: task.id, dealName: "Acme MA導入", status: "open" }),
    ]);
    await expect(
      client.deals.updateTask({ dealId: created.id, taskId: task.id, status: "completed" }),
    ).resolves.toMatchObject({ status: "completed", completedAt: expect.any(String) });
    await expect(client.deals.listTasks({ status: "open" })).resolves.toEqual([]);
    await expect(client.deals.listTasks({ status: "completed" })).resolves.toEqual([
      expect.objectContaining({ id: task.id, status: "completed" }),
    ]);

    await expect(client.deals.update({ id: created.id, status: "won" })).resolves.toMatchObject({
      status: "won",
      wonAt: expect.any(String),
      lostAt: null,
    });

    const list = await client.deals.list({ pipelineId: pipeline.id, status: "all" });
    expect(list.items).toEqual([expect.objectContaining({ id: created.id })]);
    expect(list.summary).toMatchObject({
      openCount: 0,
      wonCount: 1,
      wonValue: 1_500_000,
    });

    const detail = await client.deals.get({ id: created.id });
    expect(detail.tasks).toEqual([expect.objectContaining({ id: task.id, status: "completed" })]);
    await expect(client.deals.archive({ id: created.id })).resolves.toEqual({ ok: true });
    await expect(client.deals.get({ id: created.id })).rejects.toMatchObject({
      code: "DEAL_NOT_FOUND",
      status: 404,
    });
    await expect(client.deals.listTasks({ status: "all" })).resolves.toEqual([]);
  });

  it("treats `_` in a deal search query as a literal character, not a wildcard", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB, {
      timezone: "Asia/Tokyo",
    });
    await seedMember(env.DB, { workspaceId, userId });
    const options = await client.deals.options();
    const pipeline = options.pipelines[0]!;
    const stageId = pipeline.stages[0]!.id;

    const underscored = await client.deals.create({
      name: "foo_bar",
      pipelineId: pipeline.id,
      stageId,
      value: 0,
      currency: "JPY",
    });
    await client.deals.create({
      name: "foobar",
      pipelineId: pipeline.id,
      stageId,
      value: 0,
      currency: "JPY",
    });

    // An unescaped `_` is a single-character wildcard and would match both
    // "foo_bar" and "foobar"; escaped, it must match only the former.
    const list = await client.deals.list({ pipelineId: pipeline.id, status: "all", q: "foo_bar" });
    expect(list.items).toEqual([expect.objectContaining({ id: underscored.id })]);
  });

  it("requires admin to archive a deal even though marketer can create one", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB, {
      role: "marketer",
    });
    await seedMember(env.DB, { workspaceId, userId });
    const options = await client.deals.options();
    const pipeline = options.pipelines[0]!;

    const deal = await client.deals.create({
      name: "Marketer's deal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      value: 0,
      currency: "JPY",
    });

    await expect(client.deals.archive({ id: deal.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("creates, updates, and archives additional pipelines", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB, {
      timezone: "Asia/Tokyo",
    });
    await seedMember(env.DB, { workspaceId, userId });

    const options = await client.deals.options();
    const defaultPipeline = options.pipelines[0]!;

    await expect(client.deals.archivePipeline({ id: defaultPipeline.id })).rejects.toMatchObject({
      code: "LAST_DEAL_PIPELINE",
      status: 409,
    });

    const inbound = await client.deals.createPipeline({ name: "インバウンド" });
    expect(inbound).toMatchObject({
      name: "インバウンド",
      isDefault: false,
      stages: [
        expect.objectContaining({ name: "新規" }),
        expect.objectContaining({ name: "連絡済み" }),
        expect.objectContaining({ name: "提案" }),
        expect.objectContaining({ name: "交渉" }),
        expect.objectContaining({ name: "最終確認" }),
      ],
    });

    await expect(client.deals.createPipeline({ name: "インバウンド" })).rejects.toMatchObject({
      code: "DEAL_PIPELINE_CONFLICT",
      status: 409,
    });

    const hiring = await client.deals.createPipeline({
      name: "採用",
      stages: [
        { name: "応募", color: "#3b82f6", probability: 20 },
        { name: "面接", color: "#8b5cf6", probability: 60 },
      ],
    });
    expect(hiring.stages.map((stage) => stage.name)).toEqual(["応募", "面接"]);

    const promoted = await client.deals.updatePipeline({
      id: inbound.id,
      name: "パートナー",
      isDefault: true,
      stages: [
        { id: inbound.stages[0]!.id, name: "受付", color: "#64748b", probability: 10 },
        {
          id: inbound.stages[1]!.id,
          name: inbound.stages[1]!.name,
          color: inbound.stages[1]!.color,
          probability: inbound.stages[1]!.probability,
        },
        { name: "クローズ", color: "#10b981", probability: 90 },
      ],
    });
    expect(promoted).toMatchObject({ name: "パートナー", isDefault: true });
    expect(promoted.stages.map((stage) => stage.name)).toEqual(["受付", "連絡済み", "クローズ"]);

    const listed = await client.deals.options();
    expect(listed.pipelines.map((pipeline) => pipeline.name).sort()).toEqual(
      ["パートナー", "セールスパイプライン", "採用"].sort(),
    );
    expect(listed.pipelines.find((pipeline) => pipeline.id === inbound.id)?.isDefault).toBe(true);
    expect(listed.pipelines.find((pipeline) => pipeline.id === defaultPipeline.id)?.isDefault).toBe(
      false,
    );

    await client.deals.create({
      name: "パートナー案件",
      pipelineId: inbound.id,
      stageId: promoted.stages[0]!.id,
      value: 0,
      currency: "JPY",
    });
    await expect(
      client.deals.updatePipeline({
        id: inbound.id,
        stages: promoted.stages.slice(1).map((stage) => ({
          id: stage.id,
          name: stage.name,
          color: stage.color,
          probability: stage.probability,
        })),
      }),
    ).rejects.toMatchObject({ code: "DEAL_STAGE_IN_USE", status: 409 });
    await expect(client.deals.archivePipeline({ id: inbound.id })).rejects.toMatchObject({
      code: "DEAL_PIPELINE_IN_USE",
      status: 409,
    });

    await expect(client.deals.archivePipeline({ id: hiring.id })).resolves.toEqual({ ok: true });
    await expect(client.deals.archivePipeline({ id: defaultPipeline.id })).resolves.toEqual({
      ok: true,
    });
    const remaining = await client.deals.options();
    expect(remaining.pipelines).toEqual([
      expect.objectContaining({ id: inbound.id, isDefault: true, name: "パートナー" }),
    ]);
    await expect(client.deals.archivePipeline({ id: inbound.id })).rejects.toMatchObject({
      code: "LAST_DEAL_PIPELINE",
      status: 409,
    });
  });
});
