import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { runArchitectureCheck } from "../index.mjs";
import { fixture, run } from "./helpers.mjs";

function bridgeFiles(target) {
  return {
    "apps/server/src/example.ts": 'import "@fixture/bridge";\n',
    "packages/bridge/package.json": JSON.stringify({
      name: "@fixture/bridge",
      exports: { ".": target },
    }),
    "packages/bridge/src/raw.ts": 'export * from "../../database/src/schema";\n',
    "packages/bridge/src/safe.ts": "export const safe = true;\n",
    "packages/database/src/schema.ts": "export const schema = {};\n",
  };
}

await test("architecture API isolates package resolution and provenance between roots", async (t) => {
  const unsafeRoot = await fixture(bridgeFiles("./src/raw.ts"));
  const safeRoot = await fixture(bridgeFiles("./src/safe.ts"));
  t.after(() =>
    Promise.all([unsafeRoot, safeRoot].map((root) => rm(root, { recursive: true, force: true }))),
  );

  const first = await runArchitectureCheck({ root: unsafeRoot });
  // The raw bridge itself remains a violation in both roots. Only the package
  // export target determines whether the server's import exposes that schema.
  assert.equal(first.fileCount, 4);
  assert.ok(first.violations.some((message) => message.startsWith("apps/server/src/example.ts:")));
  const second = await runArchitectureCheck({ root: safeRoot });
  assert.equal(second.fileCount, 4);
  assert.ok(second.violations.length > 0);
  assert.ok(
    second.violations.every((message) => !message.startsWith("apps/server/src/example.ts:")),
  );
  assert.deepEqual(await runArchitectureCheck({ root: unsafeRoot }), first);
  assert.deepEqual(await runArchitectureCheck({ root: safeRoot }), second);
  assert.deepEqual(
    await Promise.all(
      [unsafeRoot, safeRoot, unsafeRoot].map((root) => runArchitectureCheck({ root })),
    ),
    [first, second, first],
  );
});

await test("architecture API rebuilds source facts, package exports, and file inventory on repeat runs", async (t) => {
  const root = await fixture(bridgeFiles("./src/raw.ts"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.ok((await runArchitectureCheck({ root })).violations.length > 0);

  await writeFile(resolve(root, "packages/bridge/src/raw.ts"), "export const safe = true;\n");
  assert.deepEqual(await runArchitectureCheck({ root }), { fileCount: 4, violations: [] });

  await writeFile(
    resolve(root, "packages/bridge/package.json"),
    JSON.stringify({
      name: "@fixture/bridge",
      exports: { ".": "../database/src/schema.ts" },
    }),
  );
  assert.ok(
    (await runArchitectureCheck({ root })).violations.some((message) =>
      message.startsWith("apps/server/src/example.ts:"),
    ),
  );

  await rm(resolve(root, "apps/server/src/example.ts"));
  assert.deepEqual(await runArchitectureCheck({ root }), { fileCount: 3, violations: [] });
});

await test("architecture API isolates cycle traversal and returns fresh violation arrays", async (t) => {
  const cyclic = await fixture({
    "apps/client/src/a.ts": 'import "@/b";\n',
    "apps/client/src/b.ts": 'import "@/a";\n',
  });
  const clean = await fixture({ "apps/client/src/a.ts": "export {};\n" });
  t.after(() =>
    Promise.all([cyclic, clean].map((root) => rm(root, { recursive: true, force: true }))),
  );
  const first = await runArchitectureCheck({ root: cyclic });
  assert.deepEqual(first, {
    fileCount: 2,
    violations: [
      "dependency cycle: apps/client/src/a.ts -> apps/client/src/b.ts -> apps/client/src/a.ts",
    ],
  });
  assert.deepEqual(await runArchitectureCheck({ root: clean }), { fileCount: 1, violations: [] });
  first.violations.length = 0;
  assert.equal((await runArchitectureCheck({ root: cyclic })).violations.length, 1);
});

await test("architecture API recovers after a parse failure and reports empty workspaces", async (t) => {
  const broken = await fixture({ "apps/client/src/broken.ts": "export function Broken( {\n" });
  const empty = await fixture({});
  t.after(() =>
    Promise.all([broken, empty].map((root) => rm(root, { recursive: true, force: true }))),
  );
  assert.deepEqual(await runArchitectureCheck({ root: broken }), {
    fileCount: 1,
    violations: ["TypeScript could not parse apps/client/src/broken.ts"],
  });
  assert.deepEqual(await runArchitectureCheck({ root: empty }), { fileCount: 0, violations: [] });
  await writeFile(resolve(broken, "apps/client/src/broken.ts"), "export {};\n");
  assert.deepEqual(await runArchitectureCheck({ root: broken }), { fileCount: 1, violations: [] });
});

await test("architecture CLI retains exact success and violation output", async (t) => {
  const root = await fixture({ "apps/server/src/example.ts": "export {};\n" });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await run(root), {
    code: 0,
    stdout: "architecture: 1 source files checked; no forbidden dependencies or cycles.\n",
    stderr: "",
  });
  await writeFile(resolve(root, "apps/server/src/example.ts"), 'import "@openengage/database";\n');
  assert.deepEqual(await run(root), {
    code: 1,
    stdout: "",
    stderr:
      "Architecture violations:\n- apps/server/src/example.ts: import an owned @openengage/database subpath, not the database package root\n",
  });
});
