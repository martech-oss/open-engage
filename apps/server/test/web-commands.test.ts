import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyLandingPageDocument,
  landingPageCreateSchema,
  landingPageWriteSchema,
  signupFormCreateSchema,
  signupFormWriteSchema,
} from "@openengage/core/web";
import { createDatabase } from "@openengage/database/client";
import {
  LandingDesignRepository,
  LandingPageRepository,
  SignupFormRepository,
} from "@openengage/database/web";

import type { RuntimeEnv } from "../src/env";
import { FormCommandService } from "../src/web/form-command-service";
import { publishLandingPage } from "../src/web/landing-publication-service";
import { PageCommandService } from "../src/web/page-command-service";
import { seedWorkspaceClient, seedWorkspaceContext } from "./factory";

const runtimeEnv = env as unknown as RuntimeEnv;

afterEach(() => vi.restoreAllMocks());

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

async function commandFixture() {
  const workspace = await seedWorkspaceContext(env.DB, "web-commands");
  const database = createDatabase(env.DB);
  return {
    workspace,
    database,
    pages: new PageCommandService(database, workspace, runtimeEnv),
    forms: new FormCommandService(database, workspace, runtimeEnv),
    designs: new LandingDesignRepository(database, workspace),
  };
}

describe("Web commands", () => {
  it("creates a default document without adding it or an automatic slug to frozen caller input", async () => {
    const { pages, designs } = await commandFixture();
    const input = freezeDeep(landingPageCreateSchema.parse({ name: "Default" }));
    const original = structuredClone(input);
    const created = await pages.create(input);
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok") throw new Error("Expected creation");
    const version = await designs.version(created.id, created.versionId);
    expect(version?.document.title).toBe("Default");
    expect(await designs.page(created.id)).toMatchObject({ slug: "default", status: "draft" });
    expect(input).toEqual(original);
    expect(input).not.toHaveProperty("document");
    expect(input).not.toHaveProperty("slug");
  });

  it("sanitizes real create/update writes without mutating frozen documents or the published version", async () => {
    const { pages, designs } = await commandFixture();
    const input = freezeDeep(
      landingPageCreateSchema.parse({
        name: "Immutable",
        status: "published",
        document: {
          ...emptyLandingPageDocument("Original"),
          html: '<main onclick="alert(1)">Original</main>',
        },
      }),
    );
    const original = structuredClone(input);
    const created = await pages.create(input);
    if (created.kind !== "ok") throw new Error("Expected creation");
    const first = await designs.version(created.id, created.versionId);
    expect(first?.document.html).toBe("<main>Original</main>");
    expect(first?.publishedDocument?.html).toBe("<main>Original</main>");
    expect(first?.publishedAt).toEqual(expect.any(String));
    expect(await designs.page(created.id)).toMatchObject({
      currentVersionId: created.versionId,
      publishedVersionId: created.versionId,
      status: "published",
    });
    expect(input).toEqual(original);

    const update = freezeDeep({
      ...landingPageWriteSchema.parse({
        ...input,
        slug: "immutable",
        baseVersionId: created.versionId,
        document: {
          ...input.document,
          title: "Updated",
          html: '<main onclick="alert(2)">Updated</main>',
        },
      }),
      id: created.id,
    });
    const originalUpdate = structuredClone(update);
    const updated = await pages.update(update);
    if (updated.kind !== "ok") throw new Error("Expected update");
    expect(updated.versionId).not.toBe(created.versionId);
    expect(await designs.version(created.id, updated.versionId)).toMatchObject({
      version: 2,
      document: { title: "Updated", html: "<main>Updated</main>" },
      publishedAt: null,
    });
    expect(await designs.version(created.id, created.versionId)).toEqual(first);
    expect(await designs.page(created.id)).toMatchObject({
      currentVersionId: updated.versionId,
      publishedVersionId: created.versionId,
    });
    expect(await designs.versions(created.id)).toHaveLength(2);
    expect(update).toEqual(originalUpdate);
  });

  it("retries an automatic form slug after a real unique collision, but returns explicit conflicts", async () => {
    const { forms, database, workspace } = await commandFixture();
    const input = freezeDeep(signupFormCreateSchema.parse({ name: "Signup", definition: {} }));
    const original = structuredClone(input);
    expect((await forms.create(input)).kind).toBe("ok");
    // Simulate another writer taking the slug after the availability query.
    const availability = vi
      .spyOn(SignupFormRepository.prototype, "isSlugAvailable")
      .mockResolvedValueOnce(true);
    const retried = await forms.create(input);
    expect(retried.kind).toBe("ok");
    expect(availability.mock.calls.map(([slug]) => slug)).toEqual(["signup", "signup", "signup-2"]);
    const repository = new SignupFormRepository(database, workspace);
    expect((await repository.listSignupForms()).map((form) => form.slug).sort()).toEqual([
      "signup",
      "signup-2",
    ]);
    availability.mockClear();
    const conflict = await forms.create({ ...input, slug: "signup" });
    expect(conflict).toMatchObject({ kind: "slug_taken", cause: expect.any(Error) });
    expect(availability).not.toHaveBeenCalled();
    if (retried.kind !== "ok") throw new Error("Expected retried creation");
    expect(
      await forms.update({
        ...signupFormWriteSchema.parse({ ...input, slug: "signup" }),
        id: retried.id,
      }),
    ).toMatchObject({ kind: "slug_taken" });
    expect((await repository.listSignupForms()).map((form) => form.slug).sort()).toEqual([
      "signup",
      "signup-2",
    ]);
    expect(input).toEqual(original);
  });

  it("retries an automatic page slug after a real unique collision, but returns explicit conflicts", async () => {
    const { pages, database, workspace, designs } = await commandFixture();
    const input = freezeDeep(landingPageCreateSchema.parse({ name: "Landing" }));
    expect((await pages.create(input)).kind).toBe("ok");
    const availability = vi
      .spyOn(LandingPageRepository.prototype, "isSlugAvailable")
      .mockResolvedValueOnce(true);
    const retried = await pages.create(input);
    expect(retried.kind).toBe("ok");
    expect(availability.mock.calls.map(([slug]) => slug)).toEqual([
      "landing",
      "landing",
      "landing-2",
    ]);
    const repository = new LandingPageRepository(database, workspace);
    expect((await repository.listLandingPages()).map((page) => page.slug).sort()).toEqual([
      "landing",
      "landing-2",
    ]);
    availability.mockClear();
    expect(await pages.create({ ...input, slug: "landing" })).toMatchObject({
      kind: "slug_taken",
      cause: expect.any(Error),
    });
    expect(availability).not.toHaveBeenCalled();
    if (retried.kind !== "ok") throw new Error("Expected retried creation");
    expect(
      await pages.update({
        ...landingPageWriteSchema.parse({ ...input, slug: "landing" }),
        id: retried.id,
      }),
    ).toMatchObject({ kind: "slug_taken" });
    expect(await designs.versions(retried.id)).toHaveLength(1);
    expect((await repository.listLandingPages()).map((page) => page.slug).sort()).toEqual([
      "landing",
      "landing-2",
    ]);
  });

  it("does not retry or convert unrelated create constraints into slug conflicts", async () => {
    const { pages, forms } = await commandFixture();
    const pageError = new Error("UNIQUE constraint failed: landing_pages.id");
    const pageWrite = vi
      .spyOn(LandingPageRepository.prototype, "createLandingPage")
      .mockRejectedValue(pageError);
    await expect(pages.create(landingPageCreateSchema.parse({ name: "Other" }))).rejects.toBe(
      pageError,
    );
    expect(pageWrite).toHaveBeenCalledTimes(1);
    const formError = new Error("UNIQUE constraint failed: forms.id");
    const formWrite = vi
      .spyOn(SignupFormRepository.prototype, "createSignupForm")
      .mockRejectedValue(formError);
    await expect(
      forms.create(signupFormCreateSchema.parse({ name: "Other", definition: {} })),
    ).rejects.toBe(formError);
    expect(formWrite).toHaveBeenCalledTimes(1);
  });

  it("retains a saved draft when immediate document publication throws and maps the error at the router", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const document = {
      ...emptyLandingPageDocument("Requires Turnstile"),
      html: '<main><div data-oe-form="signup"></div></main>',
      forms: [
        {
          refId: "signup",
          name: "Signup",
          definition: { progressiveMaxFields: 3 },
          successMessage: "Thanks",
          turnstileEnabled: true,
        },
      ],
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      client.website.createPage({ name: "Requires Turnstile", status: "published", document }),
    ).rejects.toMatchObject({ code: "PAGE_INVALID", status: 422 });
    expect(errorLog).toHaveBeenCalledOnce();
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
      event: "orpc.request_failed",
      error: { message: "ページの参照または設定を確認してください" },
    });
    errorLog.mockRestore();
    const [page] = await client.website.listPages();
    expect(page).toMatchObject({ status: "draft", publishedVersionId: null });
    const design = await client.website.getPageDesign({ id: page!.id });
    expect(design.versions).toHaveLength(1);
    expect(design.versions[0]).toMatchObject({
      id: page!.currentVersionId,
      version: 1,
      publishedAt: null,
    });
    await expect(
      publishLandingPage(createDatabase(env.DB), workspaceId, runtimeEnv, {
        id: page!.id,
        versionId: page!.currentVersionId!,
        baseVersionId: page!.currentVersionId!,
      }),
    ).rejects.toThrow("Turnstile");
  });

  it("keeps legacy content publication on the initially created version", async () => {
    const { pages, designs } = await commandFixture();
    const created = await pages.create(
      landingPageCreateSchema.parse({
        name: "Legacy",
        status: "published",
        content: { schemaVersion: 1, blocks: [] },
      }),
    );
    if (created.kind !== "ok") throw new Error("Expected creation");
    expect(await designs.page(created.id)).toMatchObject({
      status: "published",
      currentVersionId: created.versionId,
      publishedVersionId: created.versionId,
    });
    expect(
      await env.DB.prepare("SELECT document, published_at FROM landing_page_versions WHERE id=?")
        .bind(created.versionId)
        .first(),
    ).toEqual({ document: null, published_at: expect.any(String) });
  });

  it("returns missing/stale publication outcomes before validating references", async () => {
    const { pages, database, workspace } = await commandFixture();
    const created = await pages.create(
      landingPageCreateSchema.parse({
        name: "Publication",
        document: {
          ...emptyLandingPageDocument(),
          html: '<main><div data-oe-form="signup"></div></main>',
          forms: [{ refId: "signup", name: "Signup", definition: {}, turnstileEnabled: true }],
        },
      }),
    );
    if (created.kind !== "ok") throw new Error("Expected creation");
    const input = {
      id: created.id,
      versionId: created.versionId,
      baseVersionId: created.versionId,
    };
    await expect(
      publishLandingPage(database, workspace.workspaceId, runtimeEnv, { ...input, id: "missing" }),
    ).resolves.toBe("not_found");
    await expect(
      publishLandingPage(database, workspace.workspaceId, runtimeEnv, {
        ...input,
        versionId: "missing",
      }),
    ).resolves.toBe("not_found");
    await expect(
      publishLandingPage(database, workspace.workspaceId, runtimeEnv, {
        ...input,
        baseVersionId: "stale",
      }),
    ).resolves.toBe("conflict");
    await expect(
      publishLandingPage(database, workspace.workspaceId, runtimeEnv, input),
    ).rejects.toThrow("Turnstile");
  });

  it.each(["not_found", "conflict"] as const)(
    "preserves create success when immediate publication returns %s",
    async (outcome) => {
      const { pages, designs } = await commandFixture();
      const readPage = designs.page.bind(designs);
      vi.spyOn(LandingDesignRepository.prototype, "page").mockImplementationOnce(async (id) => {
        const page = await readPage(id);
        return outcome === "not_found"
          ? null
          : { ...page!, currentVersionId: "concurrent-version" };
      });
      const created = await pages.create(
        landingPageCreateSchema.parse({ name: "Race", status: "published" }),
      );
      if (created.kind !== "ok") throw new Error("Expected original create success");
      expect(await designs.page(created.id)).toMatchObject({
        status: "draft",
        currentVersionId: created.versionId,
        publishedVersionId: null,
      });
      expect(await designs.versions(created.id)).toHaveLength(1);
    },
  );
});
