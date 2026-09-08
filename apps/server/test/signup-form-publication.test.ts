import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { signupFormWriteSchema } from "@openengage/core/web";
import {
  createDatabase,
  forms,
  formVersions,
  formProgramBindings,
} from "@openengage/database/testing";
import { PublicFormRepository, SignupFormRepository } from "@openengage/database/web";

import { seedWorkspaceClient } from "./factory";

function versions(workspaceId: string, formId: string) {
  return createDatabase(env.DB)
    .orm.select()
    .from(formVersions)
    .where(and(eq(formVersions.workspaceId, workspaceId), eq(formVersions.formId, formId)))
    .orderBy(formVersions.version);
}

// test/setup.ts applies every actual migration to the isolated D1 database.
describe("form updates and immutable publication snapshots", () => {
  it("saves drafts, publishes resolved values, and preserves prior publications on republish", async () => {
    const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
    await client.projects.variablesSave({
      projectId: null,
      key: "title",
      type: "string",
      value: "First",
      expectedRevision: 0,
    });
    const input = signupFormWriteSchema.parse({
      name: "Update form",
      slug: "update-form",
      status: "draft",
      turnstileEnabled: false,
      definition: { fields: [{ key: "email", type: "email", label: "{{variables.title}}" }] },
      successMessage: "Thanks {{variables.title}}",
    });
    const form = await client.website.createForm(input);
    await client.website.updateForm({ id: form.id, ...input, name: "Saved draft" });
    const drafts = await versions(workspaceId, form.id);
    expect(drafts.map((row) => row.version)).toEqual([1, 2]);
    expect(
      drafts.every(
        (row) =>
          row.publishedAt === null && row.variableSnapshot === null && row.programBinding === null,
      ),
    ).toBe(true);
    expect(drafts[1]!.sourceSuccessMessage).toBe("Thanks {{variables.title}}");

    await client.website.updateForm({ id: form.id, ...input, status: "published" });
    const first = (await versions(workspaceId, form.id))[2]!;
    expect(first.version).toBe(3);
    expect(first.publishedAt).toEqual(expect.any(String));
    expect(first.programBinding).toBeNull();
    expect(first.successMessage).toBe("Thanks First");
    expect(JSON.parse(first.definition).fields[0].label).toBe("First");
    expect(JSON.parse(first.sourceDefinition!).fields[0].label).toBe("{{variables.title}}");
    expect(JSON.parse(first.variableSnapshot!).values).toEqual([
      expect.objectContaining({ key: "title", value: "First", revision: 1 }),
    ]);

    await client.projects.variablesSave({
      projectId: null,
      key: "title",
      type: "string",
      value: "Second",
      expectedRevision: 1,
    });
    await client.website.updateForm({ id: form.id, ...input, status: "published" });
    const published = await versions(workspaceId, form.id);
    expect(published[2]).toEqual(first);
    expect(published[3]).toMatchObject({ version: 4, successMessage: "Thanks Second" });
    expect(
      (await new PublicFormRepository(env.DB).findPublishedForm(slug, input.slug))?.successMessage,
    ).toBe("Thanks Second");
  });

  it("updates a clone-shaped draft and publishes its variable and resolved program binding into the correct columns", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "Destination" });
    await client.projects.programSave({
      id: project.id,
      expectedRowVersion: 0,
      definition: PROJECT_PROGRAM_TEMPLATES.event,
    });
    await client.projects.programPublish({
      id: project.id,
      expectedRowVersion: 1,
      confirmed: true,
    });
    await client.projects.variablesSave({
      projectId: project.id,
      key: "title",
      type: "string",
      value: "Destination title",
      expectedRevision: 0,
    });
    const input = signupFormWriteSchema.parse({
      name: "Copied form",
      slug: "copied-form",
      status: "draft",
      variableProjectId: project.id,
      turnstileEnabled: false,
      definition: { fields: [{ key: "email", type: "email", label: "{{variables.title}}" }] },
      successMessage: "{{variables.title}}",
    });
    const orm = createDatabase(env.DB).orm,
      id = crypto.randomUUID(),
      createdAt = "2026-09-08T00:00:00.000Z";
    const source = {
      definition: JSON.stringify(input.definition),
      sourceDefinition: JSON.stringify(input.definition),
      sourceSuccessMessage: input.successMessage,
      variableProjectId: project.id,
      variableSnapshot: null,
      allowedDomains: "[]",
      turnstileEnabled: false,
      successMessage: input.successMessage,
    };
    await orm.batch([
      orm.insert(forms).values({
        id,
        workspaceId,
        name: input.name,
        slug: input.slug,
        status: "draft",
        version: 7,
        ...source,
        createdAt,
        updatedAt: createdAt,
      }),
      orm.insert(formVersions).values({
        id: crypto.randomUUID(),
        workspaceId,
        formId: id,
        version: 7,
        ...source,
        programBinding: null,
        publishedAt: null,
        createdAt,
      }),
      orm.insert(formProgramBindings).values({
        workspaceId,
        formId: id,
        projectId: project.id,
        definitionVersion: null,
        statusId: "invited",
        updatedAt: createdAt,
      }),
    ]);
    const original = (await versions(workspaceId, id))[0]!;
    const repository = new SignupFormRepository(env.DB, { workspaceId });
    expect(await repository.updateSignupForm(id, input)).toBe(true);
    const draft = (await versions(workspaceId, id))[1]!;
    expect(draft).toMatchObject({
      version: 8,
      publishedAt: null,
      programBinding: null,
      variableSnapshot: null,
    });
    expect(await repository.updateSignupForm(id, { ...input, status: "published" })).toBe(true);
    const snapshots = await versions(workspaceId, id);
    expect(snapshots[0]).toEqual(original);
    expect(snapshots[1]).toEqual(draft);
    expect(snapshots[2]).toMatchObject({
      version: 9,
      successMessage: "Destination title",
      variableProjectId: project.id,
      sourceSuccessMessage: "{{variables.title}}",
    });
    expect(snapshots[2]!.publishedAt).toEqual(expect.any(String));
    expect(JSON.parse(snapshots[2]!.programBinding!)).toEqual({
      projectId: project.id,
      definitionVersion: 1,
      statusId: "invited",
    });
    expect(JSON.parse(snapshots[2]!.variableSnapshot!)).toMatchObject({
      projectId: project.id,
      values: [expect.objectContaining({ value: "Destination title", revision: 1 })],
    });
  });
});
