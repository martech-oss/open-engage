import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { createDatabase } from "@openengage/database/client";
import { GeneratedEmailImageRepository } from "@openengage/database/messaging";

import type { RuntimeEnv } from "../src/env";
import { publishLandingPage } from "../src/web/landing-publication-service";
import { seedWorkspaceClient } from "./factory";

it.each(["draft_conflict", "form_write_failure"] as const)(
  "keeps draft images private after %s and claims them only with a successful publication",
  async (failure) => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB),
      database = createDatabase(env.DB);
    const assetId = crypto.randomUUID(),
      now = new Date().toISOString(),
      key = `${workspaceId}/generated.png`;
    await env.DB.prepare(
      "INSERT INTO assets(id,workspace_id,name,original_filename,kind,r2_key,content_type,size,checksum,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        assetId,
        workspaceId,
        "Generated",
        "generated.png",
        "image",
        key,
        "image/png",
        1,
        "test",
        "private",
        now,
        now,
      )
      .run();
    await env.ASSETS_BUCKET.put(key, new Uint8Array([1]));
    await new GeneratedEmailImageRepository(database).track({
      assetId,
      workspaceId,
      requestId: crypto.randomUUID(),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const document = {
      ...emptyLandingPageDocument(),
      html: '<main><img data-oe-image="hero"><div data-oe-form="form"></div></main>',
      images: [{ refId: "hero", assetId, alt: "Generated" }],
      forms: [
        {
          refId: "form",
          name: "Contact",
          definition: { fields: [{ key: "email", type: "email" as const, required: true }] },
          successMessage: "Done",
          turnstileEnabled: false,
        },
      ],
    };
    const page = await client.website.createPage({ name: "Assets", slug: "assets", document });
    let draftId = page.versionId,
      interrupted = false;
    if (failure === "form_write_failure")
      await env.DB.exec(
        "CREATE TRIGGER fail_form_publish BEFORE INSERT ON form_versions BEGIN SELECT RAISE(ABORT, 'forced form publication failure'); END",
      );
    const bucket = new Proxy(env.ASSETS_BUCKET, {
      get(target, property) {
        if (property === "head")
          return async (r2Key: string) => {
            if (failure === "draft_conflict" && !interrupted) {
              interrupted = true;
              draftId = (
                await client.website.updatePage({
                  id: page.id,
                  name: "New draft",
                  slug: "assets",
                  status: "draft",
                  baseVersionId: page.versionId,
                  document,
                })
              ).versionId;
            }
            return target.head(r2Key);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      publishLandingPage(
        database,
        workspaceId,
        { ...env, ASSETS_BUCKET: bucket } as unknown as RuntimeEnv,
        { id: page.id, versionId: page.versionId, baseVersionId: page.versionId },
      ),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare("SELECT visibility FROM assets WHERE id=?").bind(assetId).first(),
    ).toEqual({ visibility: "private" });
    expect(
      await env.DB.prepare("SELECT claimed_at FROM generated_email_images WHERE asset_id=?")
        .bind(assetId)
        .first(),
    ).toEqual({ claimed_at: null });
    expect((await client.website.getPageDesign({ id: page.id })).publishedVersionId).toBeNull();
    if (failure === "form_write_failure") await env.DB.exec("DROP TRIGGER fail_form_publish");
    await client.website.publishPage({
      id: page.id,
      versionId: page.versionId,
      baseVersionId: draftId,
    });
    expect(
      await env.DB.prepare("SELECT visibility FROM assets WHERE id=?").bind(assetId).first(),
    ).toEqual({ visibility: "public" });
    expect(
      await env.DB.prepare("SELECT claimed_at FROM generated_email_images WHERE asset_id=?")
        .bind(assetId)
        .first(),
    ).toEqual({ claimed_at: expect.any(String) });
  },
);
