import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { createDatabase } from "@openengage/database/client";

import { programFixture as fixture } from "./program-test-support";

it("keeps a standalone form's published binding until explicit republication", async () => {
  const { exports } = await import("cloudflare:workers");
  const { PublicFormRepository } = await import("@openengage/database/web");
  const f = await fixture();
  await f.client.projects.programSave({
    id: f.projectId,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await f.client.projects.programPublish({
    id: f.projectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const input = {
    name: "Pinned program form",
    slug: "pinned-program-form",
    status: "draft" as const,
    definition: {},
    allowedDomains: [],
    turnstileEnabled: false,
    successMessage: "Thanks",
  };
  const form = await f.client.website.createForm(input);
  const binding = { projectId: f.projectId, definitionVersion: 1, statusId: "registered" };
  await f.client.projects.programBindForm({
    id: f.projectId,
    formId: form.id,
    binding,
    confirmed: true,
  });
  await f.client.website.updateForm({ ...input, id: form.id, status: "published" });
  await f.client.projects.programBindForm({
    id: f.projectId,
    formId: form.id,
    binding: null,
    confirmed: true,
  });
  const publicForms = new PublicFormRepository(createDatabase(env.DB));
  expect((await publicForms.findPublishedForm(f.slug, input.slug))?.programBinding).toEqual(
    binding,
  );
  const submit = (email: string) =>
    exports.default.fetch(
      new Request(`http://localhost:8787/f/${f.slug}/${input.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ email }),
      }),
    );
  expect((await submit("still-bound@example.com")).status).toBe(202);
  expect((await f.client.projects.memberList({ id: f.projectId })).total).toBe(1);
  await f.client.website.updateForm({ ...input, id: form.id, status: "published" });
  expect((await publicForms.findPublishedForm(f.slug, input.slug))?.programBinding).toBeNull();
  expect((await submit("now-unbound@example.com")).status).toBe(202);
  expect((await f.client.projects.memberList({ id: f.projectId })).total).toBe(1);
});

it.each(["signed_up", "followup"])(
  "accepts returning participants when a v2 form uses %s absent from their pinned definition",
  async (statusId) => {
    const { exports } = await import("cloudflare:workers");
    const f = await fixture();
    await f.client.projects.programSave({
      id: f.projectId,
      expectedRowVersion: 0,
      definition: PROJECT_PROGRAM_TEMPLATES.event,
    });
    await f.client.projects.programPublish({
      id: f.projectId,
      expectedRowVersion: 1,
      confirmed: true,
    });
    await f.client.projects.memberMutate({
      id: f.projectId,
      contactId: f.contactId,
      statusId: "registered",
      idempotencyKey: crypto.randomUUID(),
    });
    const old = (await f.client.projects.memberList({ id: f.projectId })).items[0]!.member;
    const statuses =
      statusId === "signed_up"
        ? PROJECT_PROGRAM_TEMPLATES.event.statuses.map((status) => ({
            ...status,
            id: status.id === "registered" ? statusId : status.id,
            nextStatusIds: status.nextStatusIds.map((next) =>
              next === "registered" ? statusId : next,
            ),
          }))
        : [
            ...PROJECT_PROGRAM_TEMPLATES.event.statuses,
            { id: statusId, label: "Follow up", success: false, nextStatusIds: [] },
          ];
    await f.client.projects.programSave({
      id: f.projectId,
      expectedRowVersion: 2,
      definition: { ...PROJECT_PROGRAM_TEMPLATES.event, statuses },
    });
    await f.client.projects.programPublish({
      id: f.projectId,
      expectedRowVersion: 3,
      confirmed: true,
    });
    const input = {
      name: "Changed registration",
      slug: `returning-${statusId.replaceAll("_", "-")}`,
      status: "draft" as const,
      definition: {},
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "Thanks",
    };
    const form = await f.client.website.createForm(input);
    await f.client.projects.programBindForm({
      id: f.projectId,
      formId: form.id,
      binding: { projectId: f.projectId, definitionVersion: 2, statusId },
      confirmed: true,
    });
    await f.client.website.updateForm({ ...input, id: form.id, status: "published" });
    const email = (await f.client.contacts.get({ id: f.contactId })).email;
    const submit = (address: string) =>
      exports.default.fetch(
        new Request(`http://localhost:8787/f/${f.slug}/${input.slug}`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ email: address }),
        }),
      );
    expect((await submit(email!)).status).toBe(202);
    expect((await f.client.projects.memberList({ id: f.projectId })).items[0]?.member).toEqual(old);
    expect(
      await f.client.projects.memberHistory({ id: f.projectId, contactId: f.contactId }),
    ).toHaveLength(1);
    expect((await submit(`new-${statusId}@example.com`)).status).toBe(202);
    expect(
      (await f.client.website.listForms()).find((row) => row.id === form.id)?.submissionCount,
    ).toBe(2);
    expect(
      (await f.client.projects.memberList({ id: f.projectId })).items.find(
        (row) => row.member.contactId !== f.contactId,
      )?.member,
    ).toMatchObject({ definitionVersion: 2, statusId });
  },
);

it("keeps version-qualified segment statuses distinct when an ID changes meaning", async () => {
  const { segmentFilterSchema } = await import("@openengage/core/segments");
  const { compileWorkspaceSegmentFilter, SegmentCatalogRepository } =
    await import("@openengage/database/segments");
  const f = await fixture();
  await f.client.projects.programSave({
    id: f.projectId,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await f.client.projects.programPublish({
    id: f.projectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  await f.client.projects.memberMutate({
    id: f.projectId,
    contactId: f.contactId,
    statusId: "attended",
    idempotencyKey: crypto.randomUUID(),
  });
  await f.client.projects.programSave({
    id: f.projectId,
    expectedRowVersion: 2,
    definition: {
      ...PROJECT_PROGRAM_TEMPLATES.event,
      statuses: PROJECT_PROGRAM_TEMPLATES.event.statuses.map((status) => ({
        ...status,
        label: status.id === "attended" ? "Did not attend" : status.label,
        success: status.id === "absent",
      })),
    },
  });
  await f.client.projects.programPublish({
    id: f.projectId,
    expectedRowVersion: 3,
    confirmed: true,
  });
  const newer = await f.client.contacts.create({
    email: "different-meaning@example.com",
    customFields: {},
  });
  await f.client.projects.memberMutate({
    id: f.projectId,
    contactId: newer.id,
    statusId: "attended",
    idempotencyKey: crypto.randomUUID(),
  });
  const catalog = await new SegmentCatalogRepository(
    createDatabase(env.DB),
    f,
  ).loadGenerationCatalogRows();
  const oldChoice = catalog.projectStatuses.find(
    (option) => option.id === `${f.projectId}:1:attended`,
  )!;
  const newChoice = catalog.projectStatuses.find(
    (option) => option.id === `${f.projectId}:2:attended`,
  )!;
  expect(oldChoice.value).not.toBe(newChoice.value);
  expect(oldChoice).toMatchObject({
    programStatus: { projectId: f.projectId, definitionVersion: 1, statusId: "attended" },
  });
  const filter = segmentFilterSchema.parse({
    kind: "group",
    relation: "project_member",
    combinator: "and",
    children: [
      {
        kind: "condition",
        field: "project_status",
        operator: "eq",
        value: "attended",
        program: { projectId: f.projectId, definitionVersion: 1 },
      },
    ],
  });
  expect(filter).toMatchObject({
    children: [{ program: { projectId: f.projectId, definitionVersion: 1 } }],
  });
  const compiled = compileWorkspaceSegmentFilter(f.workspaceId, filter);
  expect(
    (
      await env.DB.prepare(compiled.sql)
        .bind(...compiled.params)
        .all()
    ).results.map((row) => row.id),
  ).toEqual([f.contactId]);
  const all = compileWorkspaceSegmentFilter(
    f.workspaceId,
    segmentFilterSchema.parse({
      kind: "group",
      relation: "project_member",
      combinator: "and",
      children: [
        { kind: "condition", field: "project_id", operator: "eq", value: f.projectId },
        { kind: "condition", field: "project_status", operator: "eq", value: "attended" },
      ],
    }),
  );
  expect(
    (
      await env.DB.prepare(all.sql)
        .bind(...all.params)
        .all()
    ).results,
  ).toHaveLength(2);
});
