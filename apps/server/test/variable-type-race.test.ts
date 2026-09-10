import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { VariableRepository, VariableRepositoryError } from "@openengage/database/projects";

import { seedWorkspaceClient } from "./factory";

it.each([
  ["workspace", "create"],
  ["project", "create"],
  ["workspace", "revive"],
  ["project", "revive"],
] as const)(
  "returns a type error when a competing scope wins before %s %s",
  async (scope, mode) => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "Concurrent variable scopes" });
    const repository = new VariableRepository(env.DB, { workspaceId });
    if (mode === "revive") {
      for (const projectId of [null, project.id]) {
        const old = await repository.save({
          projectId,
          key: "race",
          type: "string",
          value: "old",
          expectedRevision: 0,
        });
        await repository.remove({ projectId, key: "race", expectedRevision: old.revision });
      }
    }
    const losingProjectId = scope === "workspace" ? null : project.id;
    const winningProjectId = scope === "workspace" ? project.id : null;
    // Finish the competing write after the losing request's type preflight, before its real SQL.
    const delayed = beforeVariableInsert(env.DB, async () => {
      await repository.save({
        projectId: winningProjectId,
        key: "race",
        type: "number",
        value: 10,
        expectedRevision: 0,
      });
    });
    await expect(
      new VariableRepository(delayed, { workspaceId }).save({
        projectId: losingProjectId,
        key: "race",
        type: "string",
        value: "incompatible",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ name: "VariableRepositoryError", kind: "type" });
    expect(await repository.own(losingProjectId)).toEqual([]);
    expect(await repository.own(winningProjectId)).toMatchObject([{ type: "number", value: 10 }]);
  },
);

it("preserves operational database errors during variable insertion", async () => {
  const { workspaceId } = await seedWorkspaceClient(env.DB);
  const delayed = beforeVariableInsert(env.DB, async () => {
    await env.DB.prepare("DROP TABLE project_variables").run();
  });
  await expect(
    new VariableRepository(delayed, { workspaceId }).save({
      projectId: null,
      key: "unavailable",
      type: "string",
      value: "value",
      expectedRevision: 0,
    }),
  ).rejects.not.toBeInstanceOf(VariableRepositoryError);
});

function beforeVariableInsert(source: D1Database, barrier: () => Promise<void>): D1Database {
  let triggered = false;
  const wrap = (statement: D1PreparedStatement, query: string): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values), query);
        if (
          !triggered &&
          /^insert into "project_variables"/i.test(query) &&
          (property === "run" || property === "all" || property === "first" || property === "raw")
        ) {
          return async (...args: unknown[]) => {
            triggered = true;
            await barrier();
            const method = Reflect.get(target, property, target) as (
              ...values: unknown[]
            ) => unknown;
            return method.apply(target, args);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(source, {
    get(target, property) {
      if (property === "prepare") return (query: string) => wrap(target.prepare(query), query);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
