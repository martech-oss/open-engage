import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";

import { seedWorkspaceClient } from "./factory";
import { cloneOptions, finishClone } from "./project-clone-test-support";

async function qualifiedFixture(definitionVersion: number) {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Versioned program" });
  for (let version = 1; version <= 2; version++) {
    const current = await f.client.projects.programGet({ id: project.id });
    await f.client.projects.programSave({
      id: project.id,
      expectedRowVersion: current.program?.rowVersion ?? 0,
      definition: PROJECT_PROGRAM_TEMPLATES.event,
    });
    await f.client.projects.programPublish({
      id: project.id,
      expectedRowVersion: (current.program?.rowVersion ?? 0) + 1,
      confirmed: true,
    });
  }
  const filter = {
    kind: "group" as const,
    combinator: "and" as const,
    relation: "project_member" as const,
    children: [
      {
        kind: "condition" as const,
        field: "project_id" as const,
        operator: "eq" as const,
        value: project.id,
      },
      {
        kind: "condition" as const,
        field: "project_status" as const,
        operator: "eq" as const,
        value: "registered",
        program: { projectId: project.id, definitionVersion: definitionVersion },
      },
    ],
  };
  const segment = await f.client.segments.create({
    name: "Qualified audience",
    kind: "dynamic",
    filter,
  });
  expect((await f.client.segments.get({ id: segment.id })).filterAst).toEqual(filter);
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "segment",
    resourceId: segment.id,
  });
  return { f, project, filter };
}

it("clones the selected qualified program version and matches destination members", async () => {
  const { f, project, filter } = await qualifiedFixture(2);
  const clone = await f.client.projects.clonePreview({ id: project.id, options: cloneOptions });
  await finishClone(f, project.id, clone.id);
  const copied = await f.client.segments.get({
    id: clone.resources.find((r) => r.kind === "segment")!.targetId,
  });
  expect(copied.filterAst).toEqual({
    ...filter,
    children: [
      { ...filter.children[0], value: clone.targetProjectId },
      {
        ...filter.children[1],
        program: { projectId: clone.targetProjectId, definitionVersion: 1 },
      },
    ],
  });
  await f.client.projects.programPublish({
    id: clone.targetProjectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const contact = await f.client.contacts.create({
    email: "qualified-clone@example.com",
    customFields: {},
  });
  await f.client.projects.memberMutate({
    id: clone.targetProjectId,
    contactId: contact.id,
    statusId: "registered",
    source: "manual",
    idempotencyKey: crypto.randomUUID(),
    expectedRevision: 0,
  });
  const preview = await f.client.segments.preview({ filter: copied.filterAst! });
  expect(preview.matchedCount).toBe(1);
  expect((await f.client.projects.memberList({ id: project.id })).total).toBe(0);
});

it("rejects an older qualified program version before creating a clone job", async () => {
  const { f, project } = await qualifiedFixture(1);
  await expect(
    f.client.projects.clonePreview({ id: project.id, options: cloneOptions }),
  ).rejects.toMatchObject({
    code: "PROJECT_CLONE_CONFLICT",
    message: expect.stringContaining("Qualified audience"),
  });
  expect((await f.client.projects.cloneList({ id: project.id })).items).toHaveLength(0);
});
