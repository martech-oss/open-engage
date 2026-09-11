import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, "..");
const turbo = resolve(repository, "node_modules/.bin/turbo");
const packages = [
  "apps/agent",
  "apps/client",
  "apps/server",
  "packages/core",
  "packages/database",
  "packages/orpc",
  "packages/sdk",
  "packages/create-openengage",
];

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "openengage-turbo-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "tsconfig.base.json",
    ".gitignore",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    "knip.jsonc",
  ];
  for (const directory of packages) {
    files.push(`${directory}/package.json`, `${directory}/tsconfig.json`);
    if (directory.startsWith("apps/")) {
      files.push(`${directory}/turbo.json`, `${directory}/wrangler.jsonc`);
    }
  }
  for (const file of files) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await copyFile(resolve(repository, file), resolve(root, file));
  }
  for (const [file, contents] of Object.entries({
    "README.md": "# Fixture\n",
    "apps/client/src/server.ts": "export default {};\n",
    "apps/server/src/index.ts": "export default {};\n",
    "apps/server/src/runtime/example.ts": "export const example = true;\n",
    "apps/server/test/example.test.ts": "export const example = true;\n",
    "packages/core/src/index.ts": "export const example = true;\n",
    "packages/database/migrations/example.sql": "SELECT 1;\n",
    "apps/client/worker-configuration.d.ts": "interface CloudflareBindings {}\n",
    "apps/server/worker-configuration.d.ts": "interface ServerBindings {}\n",
    "apps/agent/worker-configuration.d.ts": "interface AgentBindings {}\n",
  })) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await writeFile(resolve(root, file), contents);
  }
  await exec("git", ["init", "--quiet"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  // These generated declarations are currently tracked despite the ignore rule.
  await exec(
    "git",
    ["add", "--force", ...packages.slice(0, 3).map((p) => `${p}/worker-configuration.d.ts`)],
    { cwd: root },
  );
  return root;
}

async function snapshot(root) {
  const { stdout } = await exec(
    turbo,
    [
      "run",
      "build",
      "test",
      "typecheck",
      "//#lint",
      "//#format:check",
      "--dry=json",
      "--cache=local:rw",
    ],
    {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
    },
  );
  return new Map(JSON.parse(stdout).tasks.map((task) => [task.taskId, task]));
}

void test("Turborepo invalidates tasks for their actual inputs", async (t) => {
  const root = await fixture(t);
  const before = await snapshot(root);
  const scenarios = [
    {
      name: "Server implementation invalidates Client build and typecheck",
      file: "apps/server/src/runtime/example.ts",
      changed: [
        "@openengage/client#build",
        "@openengage/client#typecheck",
        "@openengage/server#test",
      ],
      unchanged: [
        "@openengage/client#test",
        "@openengage/agent#build",
        "@openengage/server#cf:types",
      ],
    },
    {
      name: "Server tests do not regenerate Worker declarations",
      file: "apps/server/test/example.test.ts",
      changed: ["@openengage/server#test"],
      unchanged: ["@openengage/server#cf:types", "@openengage/client#cf:types"],
    },
    {
      name: "entrypoint exports remain inputs to both Worker declaration generators",
      file: "apps/server/src/index.ts",
      changed: ["@openengage/server#cf:types", "@openengage/client#cf:types"],
    },
    {
      name: "database migrations invalidate Server tests through the dependency graph",
      file: "packages/database/migrations/example.sql",
      changed: ["@openengage/server#test"],
      unchanged: ["@openengage/agent#test"],
    },
    {
      name: "Core source invalidates dependent builds, types and tests",
      file: "packages/core/src/index.ts",
      changed: [
        "@openengage/client#build",
        "@openengage/server#typecheck",
        "@openengage/agent#test",
      ],
    },
    {
      name: "documentation only invalidates formatting",
      file: "README.md",
      changed: ["//#format:check"],
      unchanged: ["//#lint", "@openengage/server#test", "@openengage/client#build"],
    },
    {
      name: "generated declarations do not churn runtime tests or repository checks",
      file: "apps/server/worker-configuration.d.ts",
      unchanged: ["@openengage/server#test", "//#lint", "//#format:check"],
    },
    {
      name: "ignored Vite environment files invalidate the Client build",
      file: "apps/client/.env.local",
      contents: "VITE_EXAMPLE=changed\n",
      changed: ["@openengage/client#build"],
      unchanged: ["@openengage/server#test"],
    },
    {
      name: "ignored local bindings invalidate Worker type generation",
      file: "apps/server/.dev.vars",
      contents: "EXAMPLE=changed\n",
      changed: ["@openengage/server#cf:types", "@openengage/client#typecheck"],
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const path = resolve(root, scenario.file);
      const original = await readFile(path, "utf8").catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      try {
        await writeFile(path, scenario.contents ?? `${original}\n// changed\n`);
        const after = await snapshot(root);
        for (const id of scenario.changed ?? []) {
          assert.notEqual(after.get(id)?.hash, before.get(id)?.hash, `${id} must invalidate`);
        }
        for (const id of scenario.unchanged ?? []) {
          assert.equal(after.get(id)?.hash, before.get(id)?.hash, `${id} must remain reusable`);
        }
      } finally {
        if (original === undefined) await rm(path);
        else await writeFile(path, original);
      }
    });
  }
  await t.test("Client typecheck schedules Server type generation before consuming it", () => {
    assert.ok(
      before
        .get("@openengage/client#typecheck")
        .dependencies.includes("@openengage/server#cf:types"),
    );
  });
});
