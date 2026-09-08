import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { VariableRepository } from "@openengage/database/projects";

import { seedWorkspaceClient } from "./factory";

it.each([
  ["workspace", "update"],
  ["workspace", "delete"],
  ["project", "update"],
  ["project", "delete"],
] as const)("rejects stale %s key %s after recreation", async (scope, operation) => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const projectId =
    scope === "project"
      ? (await client.projects.create({ name: "Scope", description: "", color: "#123456" })).id
      : null;
  const input = { projectId, key: "title", type: "string" as const };
  const first = await client.projects.variablesSave({
    ...input,
    value: "first",
    expectedRevision: 0,
  });
  await client.projects.variablesDelete({
    projectId,
    key: input.key,
    expectedRevision: first.revision,
  });
  const repository = new VariableRepository(env.DB, { workspaceId });
  expect(await repository.own(projectId)).toEqual([]);
  const replacement = await client.projects.variablesSave({
    ...input,
    value: "second",
    expectedRevision: 0,
  });
  await expect(
    operation === "update"
      ? client.projects.variablesSave({
          ...input,
          value: "stale",
          expectedRevision: first.revision,
        })
      : client.projects.variablesDelete({
          projectId,
          key: input.key,
          expectedRevision: first.revision,
        }),
  ).rejects.toMatchObject({ code: "VARIABLE_CONFLICT" });
  expect(replacement.revision).toBeGreaterThan(first.revision);
  expect((await repository.own(projectId))[0]).toMatchObject({
    value: "second",
    revision: replacement.revision,
  });
  const saved = await client.projects.variablesSave({
    ...input,
    value: "current",
    expectedRevision: replacement.revision,
  });
  await client.projects.variablesDelete({
    projectId,
    key: input.key,
    expectedRevision: saved.revision,
  });
  expect(await repository.own(projectId)).toEqual([]);
});

it("revives atomically and checks types against active scopes while ignoring deleted definitions", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const project = await client.projects.create({
    name: "Override",
    description: "",
    color: "#123456",
  });
  const initial = await client.projects.variablesSave({
    projectId: null,
    key: "value",
    type: "string",
    value: "old",
    expectedRevision: 0,
  });
  await client.projects.variablesDelete({
    projectId: null,
    key: "value",
    expectedRevision: initial.revision,
  });
  await client.projects.variablesSave({
    projectId: project.id,
    key: "value",
    type: "number",
    value: 10,
    expectedRevision: 0,
  });
  await expect(
    client.projects.variablesSave({
      projectId: null,
      key: "value",
      type: "string",
      value: "incompatible",
      expectedRevision: 0,
    }),
  ).rejects.toMatchObject({ code: "VARIABLE_INVALID" });
  const results = await Promise.allSettled(
    [20, 30].map((value) =>
      client.projects.variablesSave({
        projectId: null,
        key: "value",
        type: "number",
        value,
        expectedRevision: 0,
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "VARIABLE_CONFLICT" },
  });
  const recreated = (await client.projects.variablesList({ projectId: null })).definitions[0]!;
  expect(recreated.type).toBe("number");
  expect(recreated.revision).toBeGreaterThan(initial.revision);
});

it("keeps cross-scope types consistent when incompatible recreations race", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const project = await client.projects.create({ name: "Racing scopes" });
  for (const projectId of [null, project.id]) {
    const first = await client.projects.variablesSave({
      projectId,
      key: "race",
      type: "string",
      value: "old",
      expectedRevision: 0,
    });
    await client.projects.variablesDelete({
      projectId,
      key: "race",
      expectedRevision: first.revision,
    });
  }
  const results = await Promise.allSettled([
    client.projects.variablesSave({
      projectId: null,
      key: "race",
      type: "number",
      value: 10,
      expectedRevision: 0,
    }),
    client.projects.variablesSave({
      projectId: project.id,
      key: "race",
      type: "string",
      value: "new",
      expectedRevision: 0,
    }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "VARIABLE_INVALID" },
  });
  expect((await client.projects.variablesList({ projectId: project.id })).definitions).toHaveLength(
    1,
  );
});
