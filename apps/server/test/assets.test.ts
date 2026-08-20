import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@openengage/database/testing";

import { seedWorkspaceClient } from "./factory";

function pngFile(name: string, body = "openengage"): File {
  return new File([body], name, { type: "image/png" });
}

describe("Asset library", () => {
  it("walks an asset through upload, edit, archive, restore and delete", async () => {
    const { client, slug } = await seedWorkspaceClient(env.DB);

    const uploaded = await client.assets.upload({ name: "hero.png", file: pngFile("hero.png") });
    expect(uploaded).toMatchObject({
      name: "hero.png",
      originalFilename: "hero.png",
      kind: "image",
      visibility: "private",
      publicUrl: null,
      archivedAt: null,
      checksumAlgorithm: "sha256",
      size: 10,
    });

    await expect(client.assets.get({ id: uploaded.id })).resolves.toMatchObject({
      id: uploaded.id,
      description: "",
      altText: "",
    });

    const published = await client.assets.update({
      id: uploaded.id,
      name: "ヒーロー画像",
      description: "トップページ用",
      altText: "製品のスクリーンショット",
      visibility: "public",
    });
    expect(published.name).toBe("ヒーロー画像");
    expect(published.altText).toBe("製品のスクリーンショット");
    // Public URLs are absolute and carry the checksum prefix as a cache buster.
    expect(published.publicUrl).toBe(
      `${env.APP_URL}/a/${slug}/${uploaded.id}/hero.png?v=${published.checksum.slice(0, 12)}`,
    );

    await expect(client.assets.archive({ id: uploaded.id })).resolves.toEqual({ ok: true });
    // Archiving withdraws the public URL even though visibility is still public.
    await expect(client.assets.get({ id: uploaded.id })).resolves.toMatchObject({
      publicUrl: null,
    });
    await expect(client.assets.update({ id: uploaded.id, name: "x" })).rejects.toMatchObject({
      code: "ASSET_ARCHIVED",
    });
    await expect(client.assets.archive({ id: uploaded.id })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });

    await expect(client.assets.restore({ id: uploaded.id })).resolves.toEqual({ ok: true });
    await expect(client.assets.restore({ id: uploaded.id })).rejects.toMatchObject({
      code: "ASSET_NOT_ARCHIVED",
    });

    await expect(client.assets.delete({ id: uploaded.id })).resolves.toEqual({ ok: true });
    await expect(client.assets.get({ id: uploaded.id })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
  });

  it("filters the library by kind, status, visibility and name", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const image = await client.assets.upload({ name: "banner.png", file: pngFile("banner.png") });
    const ebook = await client.assets.upload({
      name: "guide.pdf",
      file: new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" }),
      visibility: "public",
    });
    const blob = await client.assets.upload({
      name: "archive.zip",
      file: new File(["PK"], "archive.zip", { type: "application/zip" }),
    });

    const all = await client.assets.list({});
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.id)).toEqual([blob.id, ebook.id, image.id]);

    await expect(client.assets.list({ kind: "image" })).resolves.toMatchObject({ total: 1 });
    await expect(client.assets.list({ kind: "document" })).resolves.toMatchObject({ total: 1 });
    await expect(client.assets.list({ kind: "other" })).resolves.toMatchObject({ total: 1 });
    await expect(client.assets.list({ visibility: "public" })).resolves.toMatchObject({ total: 1 });
    await expect(client.assets.list({ query: "guide" })).resolves.toMatchObject({ total: 1 });
    // `%`/`_` are LIKE wildcards and must be matched literally, not as wildcards,
    // when typed by a user — none of these filenames contain a literal `%`.
    await expect(client.assets.list({ query: "%" })).resolves.toMatchObject({ total: 0 });

    await client.assets.archive({ id: blob.id });
    await expect(client.assets.list({})).resolves.toMatchObject({ total: 2 });
    await expect(client.assets.list({ status: "archived" })).resolves.toMatchObject({ total: 1 });
    await expect(client.assets.list({ status: "all" })).resolves.toMatchObject({ total: 3 });
  });

  it("treats `_` in a search query as a literal character, not a wildcard", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const underscored = await client.assets.upload({
      name: "foo_bar.png",
      file: pngFile("foo_bar.png"),
    });
    await client.assets.upload({ name: "foobar.png", file: pngFile("foobar.png") });

    // An unescaped `_` is a single-character wildcard and would match both
    // "foo_bar.png" and "foobar.png"; escaped, it must match only the former.
    await expect(client.assets.list({ query: "foo_bar" })).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: underscored.id })],
    });
  });

  it("pages through the library with a cursor", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    for (const index of [0, 1, 2]) {
      await client.assets.upload({ name: `file-${index}.png`, file: pngFile(`file-${index}.png`) });
    }
    const first = await client.assets.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBeDefined();

    const second = await client.assets.list({ limit: 2, cursor: first.nextCursor ?? "" });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(3);
  });

  it("gates writes on role and isolates assets per workspace", async () => {
    const owner = await seedWorkspaceClient(env.DB);
    const analyst = await seedWorkspaceClient(env.DB, { role: "analyst" });
    const marketer = await seedWorkspaceClient(env.DB, { role: "marketer" });
    const other = await seedWorkspaceClient(env.DB);

    const asset = await owner.client.assets.upload({
      name: "shared.png",
      file: pngFile("shared.png"),
    });

    await expect(analyst.client.assets.list({})).resolves.toMatchObject({ total: 0 });
    await expect(
      analyst.client.assets.upload({ name: "nope.png", file: pngFile("nope.png") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Uploading and editing only need marketer, but archive/restore need admin -
    // even for an asset the marketer uploaded themselves.
    const own = await marketer.client.assets.upload({
      name: "own.png",
      file: pngFile("own.png"),
    });
    await expect(
      marketer.client.assets.update({ id: own.id, name: "marketer-edit" }),
    ).resolves.toMatchObject({ name: "marketer-edit" });
    await expect(marketer.client.assets.archive({ id: own.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(marketer.client.assets.restore({ id: own.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // A different workspace must not see, read or mutate another's asset.
    await expect(other.client.assets.get({ id: asset.id })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
    await expect(other.client.assets.download({ id: asset.id })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
    await expect(other.client.assets.archive({ id: asset.id })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
    await expect(other.client.assets.list({})).resolves.toMatchObject({ total: 0 });

    await expect(client404(owner.client.assets.get({ id: uuidv7() }))).resolves.toBe(
      "ASSET_NOT_FOUND",
    );
  });
});

/** Resolves to the oRPC error code, so a missing rejection fails loudly instead of passing. */
async function client404(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no-error";
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}
