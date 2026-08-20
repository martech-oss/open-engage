import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const checker = resolve(import.meta.dirname, "check-architecture.mjs");

async function fixture(files) {
  const root = await mkdtemp(resolve(tmpdir(), "openengage-architecture-"));
  await mkdir(resolve(root, "apps"), { recursive: true });
  await mkdir(resolve(root, "packages"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

async function run(root) {
  try {
    const result = await execFileAsync(process.execPath, [checker, "--root", root]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

await test("architecture policy accepts and rejects controlled repositories", async (t) => {
  const scenarios = [
    {
      name: "rejects the database root barrel in production",
      files: { "apps/server/src/contacts/service.ts": 'import "@openengage/database";\n' },
      want: "database package root",
    },
    {
      name: "rejects the testing entrypoint in production",
      files: { "apps/server/src/contacts/service.ts": 'import "@openengage/database/testing";\n' },
      want: "database testing entrypoint",
    },
    {
      name: "rejects schema and orm outside the exact Better Auth adapter",
      files: {
        "apps/server/src/auth/helper.ts":
          'import { createDatabase } from "@openengage/database/client";\n' +
          'import "@openengage/database/schema";\ncreateDatabase({}).orm;\n',
      },
      want: "Better Auth adapter",
    },
    {
      name: "allows schema and orm in the exact Better Auth adapter",
      files: {
        "apps/server/src/auth/service.ts":
          'import { createDatabase } from "@openengage/database/client";\n' +
          'import { authSchema } from "@openengage/database/schema";\n' +
          "const database = createDatabase({});\n" +
          "export const auth = database.orm;\n" +
          'export const quotedAuth = database["orm"];\n' +
          "export const templateAuth = database[`orm`];\n" +
          "export const { orm: destructuredAuth } = database;\n" +
          "void authSchema;\n",
      },
    },
    {
      name: "rejects a schema re-export hidden behind a database domain bridge",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts": 'export * from "../schema";\n',
        "packages/database/src/schema.ts": "export const schema = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a relative server import that resolves to the database schema",
      files: {
        "apps/server/src/contacts/service.ts":
          'import "../../../../packages/database/src/schema";\n',
        "packages/database/src/schema.ts": "export const schema = {};\n",
      },
      want: "Better Auth adapter",
    },
    {
      name: "allows the database client to assemble the schema internally",
      files: {
        "packages/database/src/client.ts": 'import { schema } from "./schema";\nvoid schema;\n',
        "packages/database/src/schema.ts": "export const schema = {};\n",
      },
    },
    {
      name: "rejects a quoted database orm element access outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          'declare const database: unknown;\nvoid database["orm"];\n',
      },
      want: "Better Auth adapter",
    },
    {
      name: "rejects a static template database orm element access outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          "declare const database: unknown;\nvoid database[`orm`];\n",
      },
      want: "Better Auth adapter",
    },
    {
      name: "rejects shorthand database orm destructuring outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          "declare const database: unknown;\nconst { orm } = database;\nvoid orm;\n",
      },
      want: "Better Auth adapter",
    },
    {
      name: "rejects aliased database orm destructuring outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          "declare const database: unknown;\nconst { orm: adapter } = database;\nvoid adapter;\n",
      },
      want: "Better Auth adapter",
    },
    {
      name: "resolves client aliases when detecting cycles",
      files: {
        "apps/client/src/a.ts": 'import "@/b";\n',
        "apps/client/src/b.ts": 'import "@/a";\n',
      },
      want: "dependency cycle",
    },
    {
      name: "resolves commented dynamic client aliases when detecting cycles",
      files: {
        "apps/client/src/a.ts": 'void import(/* chunk */ "@/b");\n',
        "apps/client/src/b.ts": 'import "@/a";\n',
      },
      want: "dependency cycle",
    },
    {
      name: "resolves template dynamic client aliases when detecting cycles",
      files: {
        "apps/client/src/a.ts": "void import(`@/b`);\n",
        "apps/client/src/b.ts": 'import "@/a";\n',
      },
      want: "dependency cycle",
    },
    {
      name: "resolves type-only declarations and import types when detecting cycles",
      files: {
        "apps/client/src/a.ts": 'import type { B } from "@/b";\nexport type A = B;\n',
        "apps/client/src/b.ts": 'export type B = import("@/a").A;\n',
      },
      want: "dependency cycle",
    },
    {
      name: "rejects unresolved client aliases",
      files: { "apps/client/src/a.ts": 'import "@/missing";\n' },
      want: "unresolved client alias",
    },
    {
      name: "rejects platform to channels inversion",
      files: {
        "apps/server/src/platform/signatures.ts": 'import "../channels/index";\n',
        "apps/server/src/channels/index.ts": "export {};\n",
      },
      want: "platform must not import channels",
    },
    {
      name: "rejects rendering to public inversion",
      files: {
        "apps/server/src/rendering/html.ts": 'import "../public/http";\n',
        "apps/server/src/public/http.ts": "export {};\n",
      },
      want: "rendering must not import public",
    },
    {
      name: "rejects asset and project implementations left under web",
      files: {
        "packages/database/src/web/asset-repository.ts": "export {};\n",
        "apps/server/src/web/project-service.ts": "export {};\n",
      },
      want: "implementation must live in its owning domain",
    },
    {
      name: "rejects the former contacts score schema path",
      files: { "packages/database/src/contacts/score-schema.ts": "export {};\n" },
      want: "score events belong to scoring",
    },
    {
      name: "rejects references to the former contacts score schema path",
      files: {
        "packages/database/src/scoring/repository.ts":
          'import "../contacts/score-schema";\nexport {};\n',
      },
      want: "score events belong to scoring",
    },
    {
      name: "rejects schema or foreign ownership from a database domain barrel",
      files: {
        "packages/database/src/contacts/index.ts":
          'export * from "./schema";\nexport * from "../client";\n',
        "packages/database/src/contacts/schema.ts": "export {};\n",
        "packages/database/src/client.ts": "export {};\n",
      },
      want: "domain barrel",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const root = await fixture(scenario.files);
      try {
        const result = await run(root);
        if (scenario.want) {
          assert.notEqual(result.code, 0, result.stdout);
          assert.match(result.stderr, new RegExp(scenario.want));
        } else {
          assert.equal(result.code, 0, result.stderr);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
