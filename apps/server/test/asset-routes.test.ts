import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { assets, createDatabase, uuidv7 } from "@openengage/database/testing";
import type { Asset } from "@openengage/orpc";

import { seedWorkspaceClient } from "./factory";

const APP_ORIGIN = new URL(env.APP_URL).origin;

function call(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`http://localhost:8787${path}`, init));
}

async function decodeBody(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

/** Streams bytes through the hand-written upload route the way the browser does. */
async function upload(
  token: string,
  body: string,
  options: { name: string; contentType: string; visibility?: string } = {
    name: "deck.pdf",
    contentType: "application/pdf",
  },
): Promise<Response> {
  const query = new URLSearchParams({ name: options.name });
  if (options.visibility) query.set("visibility", options.visibility);
  return call(`/api/assets/upload?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": options.contentType,
      "content-length": String(new TextEncoder().encode(body).byteLength),
    },
    body,
  });
}

describe("Asset streaming and delivery routes", () => {
  it("streams an upload into R2 and serves it back to the workspace", async () => {
    const { token, client } = await seedWorkspaceClient(env.DB);
    const body = "%PDF-1.7 openengage slide deck";

    const response = await upload(token, body);
    expect(response.status).toBe(201);
    const asset = (await response.json()) as Asset;
    expect(asset).toMatchObject({
      name: "deck.pdf",
      originalFilename: "deck.pdf",
      kind: "document",
      contentType: "application/pdf",
      visibility: "private",
      publicUrl: null,
      // Streamed uploads cannot hash incrementally, so they record R2's MD5.
      checksumAlgorithm: "md5",
      size: body.length,
    });
    await expect(client.assets.list({})).resolves.toMatchObject({ total: 1 });

    const raw = await call(`/api/assets/${asset.id}/raw`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(raw.status).toBe(200);
    expect(await decodeBody(raw)).toBe(body);
    expect(raw.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(raw.headers.get("content-security-policy")).toContain("sandbox");
    expect(raw.headers.get("content-disposition")).toContain("inline");
  });

  it("replaces asset bytes in place and moves the cache-busting version", async () => {
    const { token, client } = await seedWorkspaceClient(env.DB);
    const created = (await (
      await upload(token, "first", {
        name: "guide.pdf",
        contentType: "application/pdf",
        visibility: "public",
      })
    ).json()) as Asset;

    const replaced = await call(`/api/assets/${created.id}/content`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/pdf",
        "content-length": "6",
      },
      body: "second",
    });
    expect(replaced.status).toBe(200);
    const updated = (await replaced.json()) as Asset;
    expect(updated.id).toBe(created.id);
    expect(updated.checksum).not.toBe(created.checksum);
    expect(updated.publicUrl).not.toBe(created.publicUrl);

    await expect(client.assets.download({ id: created.id })).resolves.toBeInstanceOf(File);
    const raw = await call(`/api/assets/${created.id}/raw`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await decodeBody(raw)).toBe("second");
  });

  it("rejects malformed, oversized, executable and cross-site uploads", async () => {
    const { token } = await seedWorkspaceClient(env.DB);
    const authorization = `Bearer ${token}`;

    const noLength = await call("/api/assets/upload?name=a.png", {
      method: "POST",
      headers: { authorization, "content-type": "image/png" },
    });
    expect(noLength.status).toBe(411);

    const tooLarge = await call("/api/assets/upload?name=a.png", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "image/png",
        "content-length": String(101 * 1024 * 1024),
      },
      body: "x",
    });
    expect(tooLarge.status).toBe(413);

    const executable = await upload(token, "<svg onload='steal()' />", {
      name: "logo.svg",
      contentType: "image/svg+xml",
    });
    expect(executable.status).toBe(415);

    const noName = await call("/api/assets/upload", {
      method: "POST",
      headers: { authorization, "content-type": "image/png", "content-length": "1" },
      body: "x",
    });
    expect(noName.status).toBe(400);

    // Cookie-authenticated (no Bearer) requests must carry a matching Origin.
    const crossSite = await call("/api/assets/upload?name=a.png", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "content-length": "1",
        origin: "https://evil.example",
      },
      body: "x",
    });
    expect(crossSite.status).toBe(403);
    await expect(crossSite.json()).resolves.toMatchObject({
      error: { code: "origin_mismatch" },
    });
  });

  it("gates streaming writes on the marketer role", async () => {
    const { token } = await seedWorkspaceClient(env.DB, { role: "analyst" });
    const response = await upload(token, "nope", { name: "a.png", contentType: "image/png" });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("serves public assets anonymously and hides everything else behind one 404", async () => {
    const { token, slug, client } = await seedWorkspaceClient(env.DB);
    const body = "%PDF-1.7 public guide";
    const asset = (await (
      await upload(token, body, {
        name: "public.pdf",
        contentType: "application/pdf",
        visibility: "public",
      })
    ).json()) as Asset;
    const version = asset.checksum.slice(0, 12);

    const hit = await call(`/a/${slug}/${asset.id}/public.pdf?v=${version}`);
    expect(hit.status).toBe(200);
    expect(await decodeBody(hit)).toBe(body);
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(hit.headers.get("access-control-allow-origin")).toBe("*");
    expect(hit.headers.get("content-security-policy")).toContain("sandbox");

    // A stale or absent version only earns the short TTL.
    const stale = await call(`/a/${slug}/${asset.id}/public.pdf`);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate");

    // The filename segment is cosmetic, so renames never break pasted URLs.
    await expect(call(`/a/${slug}/${asset.id}/anything-else.pdf`)).resolves.toMatchObject({
      status: 200,
    });

    await expect(call(`/a/${slug}/${uuidv7()}/x.pdf`)).resolves.toMatchObject({ status: 404 });
    await expect(call(`/a/no-such-workspace/${asset.id}/public.pdf`)).resolves.toMatchObject({
      status: 404,
    });

    await client.assets.archive({ id: asset.id });
    await expect(call(`/a/${slug}/${asset.id}/public.pdf`)).resolves.toMatchObject({ status: 404 });
    await client.assets.restore({ id: asset.id });
    await client.assets.update({ id: asset.id, visibility: "private" });
    await expect(call(`/a/${slug}/${asset.id}/public.pdf`)).resolves.toMatchObject({ status: 404 });
  });

  it("never serves contact exports or other shared-bucket objects as assets", async () => {
    const { token, slug, workspaceId } = await seedWorkspaceClient(env.DB);
    await upload(token, "seed", { name: "seed.pdf", contentType: "application/pdf" });

    // Plant an export CSV the way the contacts worker does, then a public asset
    // row pointing straight at it - the prefix assertion must still 404.
    const exportKey = `${workspaceId}/exports/contacts-${uuidv7()}.csv`;
    await env.ASSETS_BUCKET.put(exportKey, "email,first_name\nvictim@example.com,Victim\n");
    const rogueId = uuidv7();
    const now = new Date().toISOString();
    await createDatabase(env.DB)
      .orm.insert(assets)
      .values({
        id: rogueId,
        workspaceId,
        name: "contacts.csv",
        originalFilename: "contacts.csv",
        kind: "document",
        r2Key: exportKey,
        contentType: "text/csv",
        size: 44,
        checksum: "0".repeat(64),
        visibility: "public",
        createdAt: now,
        updatedAt: now,
      });

    const leak = await call(`/a/${slug}/${rogueId}/contacts.csv`);
    expect(leak.status).toBe(404);
    expect(await leak.text()).not.toContain("victim@example.com");
  });

  it("honours range and conditional requests, and answers HEAD without a body", async () => {
    const { token, slug } = await seedWorkspaceClient(env.DB);
    const body = "0123456789abcdefghij";
    const asset = (await (
      await upload(token, body, {
        name: "range.pdf",
        contentType: "application/pdf",
        visibility: "public",
      })
    ).json()) as Asset;
    const url = `/a/${slug}/${asset.id}/range.pdf`;

    const partial = await call(url, { headers: { range: "bytes=0-9" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 0-9/${body.length}`);
    expect(await decodeBody(partial)).toBe("0123456789");

    const full = await call(url);
    const etag = full.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    const conditional = await call(url, { headers: { "if-none-match": etag } });
    expect(conditional.status).toBe(304);
    expect(await decodeBody(conditional)).toBe("");

    const head = await call(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(body.length));
    expect(await decodeBody(head)).toBe("");
  });

  it("scopes the admin raw route to the caller's workspace", async () => {
    const owner = await seedWorkspaceClient(env.DB);
    const other = await seedWorkspaceClient(env.DB);
    const asset = (await (
      await upload(owner.token, "secret", {
        name: "secret.pdf",
        contentType: "application/pdf",
      })
    ).json()) as Asset;

    await expect(
      call(`/api/assets/${asset.id}/raw`, { headers: { authorization: `Bearer ${other.token}` } }),
    ).resolves.toMatchObject({ status: 404 });
    await expect(call(`/api/assets/${asset.id}/raw`)).resolves.toMatchObject({ status: 401 });
  });

  it("keeps the origin guard off the Bearer path used by the SDK", async () => {
    const { token } = await seedWorkspaceClient(env.DB);
    const response = await call("/api/assets/upload?name=sdk.pdf", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/pdf",
        "content-length": "3",
        origin: APP_ORIGIN,
      },
      body: "sdk",
    });
    expect(response.status).toBe(201);
  });
});
