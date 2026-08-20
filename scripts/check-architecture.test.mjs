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

function sourceLines(count) {
  return [
    "export {};",
    ...Array.from({ length: count - 1 }, (_, index) => `// line ${index + 2}`),
  ].join("\n");
}

function componentLines(count) {
  return [
    "export const Fixture = () => {",
    ...Array.from({ length: count - 3 }, () => "  void 0;"),
    "  return null;",
    "};",
  ].join("\n");
}

function classMemberLines(signature, count) {
  return [
    "export class Fixture {",
    `  ${signature} {`,
    ...Array.from({ length: count - 2 }, () => "    void 0;"),
    "  }",
    "}",
  ].join("\n");
}

function nestedParentheses(expression, depth) {
  return `${"(".repeat(depth)}${expression}${")".repeat(depth)}`;
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
      name: "rejects a named imported binding re-exported through a domain bridge",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\nexport { assets };\n',
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects an aliased imported binding re-exported through a domain bridge",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as publicAssets } from "./schema";\n' +
          "export { publicAssets as assets };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a namespace imported binding re-exported through a domain bridge",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import * as assetSchema from "./schema";\nexport { assetSchema };\n',
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a default imported binding re-exported through a domain bridge",
      files: {
        "packages/database/src/assets/index.ts": 'export { default } from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import databaseClient from "../client";\nexport default databaseClient;\n',
        "packages/database/src/client.ts": "export default {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a named export fed by a raw-schema initializer alias chain",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const first = assets;\nconst second = first;\n" +
          "export const exposed = second;\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a default export fed by a raw-schema initializer alias",
      files: {
        "packages/database/src/assets/index.ts": 'export { default } from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\nexport default exposed;\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a default object surface containing a raw-schema alias",
      files: {
        "packages/database/src/assets/index.ts": 'export { default } from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\nexport default { schema: exposed };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects an exported object shorthand containing a raw-schema alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\nexport const surface = { exposed };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows an exported safe binding shadowed by a nested raw-schema alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "export const safe = {};\n" +
          "function nested() {\n  const safe = assets;\n  return safe;\n}\n" +
          "void nested;\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a raw-schema alias nested behind an object spread",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = { ...{ exposed } };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias nested in an exported array",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = [{ exposed }];\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias nested in an exported conditional",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = Math.random() > 0.5 ? exposed : {};\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias nested in an exported call argument",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = Object.freeze({ exposed });\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias returned by an arrow IIFE",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = (() => exposed)();\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias yielded by a generator IIFE",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = (function* () { yield exposed; })();\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias returned by a local function",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "function reveal() { return exposed; }\n" +
          "export const surface = reveal();\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema alias returned by an exported function",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export function reveal() { return exposed; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw-schema fields and callable outputs on an exported class",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export class Surface {\n" +
          "  static schema = exposed;\n" +
          "  get value() { return exposed; }\n" +
          "  reveal() { return exposed; }\n" +
          "}\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw-schema field exposed by an anonymous class instance",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "const exposed = assets;\n" +
          "export const surface = new (class { schema = exposed; })();\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows callable parameters and locals to shadow a raw-schema alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export const fromParameter = ((exposed) => exposed)({});\n" +
          "export const fromArrayParameter = (([, exposed]) => exposed)([null, {}]);\n" +
          "export const fromLocal = (() => {\n" +
          "  const exposed = {};\n" +
          "  return exposed;\n" +
          "})();\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "allows a callable to use schema internally and return only a safe value",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets } from "./schema";\n' +
          "function inspect() { return assets !== undefined; }\n" +
          "export const safe = inspect();\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "allows a recursive callable that exposes no raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          "export function recurse() { return recurse(); }\n",
      },
    },
    {
      name: "allows an exported class with private schema state and safe callable outputs",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class SafeSurface {\n" +
          "  private schema = exposed;\n" +
          "  reveal(exposed = {}) { return exposed; }\n" +
          "  ready() { return this.schema !== undefined; }\n" +
          "}\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a callable-local raw-schema const alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { const value = exposed; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a generator-local raw-schema let alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function* reveal() { let value = exposed; yield value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a class-method raw-schema var alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { reveal() { var value = exposed; return value; } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a function-scoped var alias declared in a nested block",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { { var value = exposed; } return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw schema returned through a catch binding",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { try { throw exposed; } catch (value) { return value; } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe array destructuring slot beside raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const [safe] = [{}, exposed]; export { safe };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects the raw array destructuring slot",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const [, surface] = [{}, exposed]; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw array binding default",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const [surface = exposed] = []; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw array binding default selected by explicit undefined",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const [surface = exposed] = [undefined]; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw destructured parameter default",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export const surface = (([value = exposed]) => value)([]);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe object destructuring slot beside raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const { safe } = { safe: {}, raw: exposed }; export { safe };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects raw schema collected by an object rest binding",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const { safe, ...surface } = { safe: {}, raw: exposed }; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw schema collected by an array rest binding",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const [, ...surface] = [{}, exposed]; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe array rest binding beside raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const [, ...safe] = [exposed, {}]; export { safe };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects raw schema returned by an imported identity call",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          'import { identity } from "./helper";\n' +
          "export const surface = identity(exposed);\n",
        "packages/database/src/assets/helper.ts": "export const identity = (value) => value;\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw schema returned by an ambient identity call",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "declare function identity(value: unknown): unknown;\n" +
          "export const surface = identity(exposed);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a known primitive sanitizer to consume raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export const safe = Boolean(exposed);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a public constructor parameter property carrying raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor(public schema = exposed) {} }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw schema passed to a public constructor parameter property",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "class Surface { constructor(public schema: unknown) {} }\n" +
          "export const surface = new Surface(exposed);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a public instance assignment carrying raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor() { this.schema = exposed; } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a public static assignment carrying raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface {}\nSurface.schema = exposed;\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a private raw field returned by a public getter",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { #schema = exposed; get value() { return this.#schema; } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a private raw field returned by a public method",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { private schema = exposed; reveal() { return this.schema; } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a private constructor property returned by a public getter",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "class Surface { constructor(private schema: unknown) {} get value() { return this.schema; } }\n" +
          "export const surface = new Surface(exposed);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects an array default fed by an undefined local binding",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const maybe = undefined; const [surface = exposed] = [maybe]; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects an object default fed by an undefined local binding",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const maybe = undefined; const { surface = exposed } = { surface: maybe }; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a parameter default fed by an undefined local binding",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const maybe = undefined; export const surface = (([value = exposed]) => value)([maybe]);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw default when the selected value has unknown definedness",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "declare const maybe: unknown; const [surface = exposed] = [maybe]; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a raw default beside a known non-undefined selected value",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const maybe = {}; const [surface = exposed] = [maybe]; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects raw schema selected through an object literal spread",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const { surface } = { ...{ surface: exposed } }; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe spread overwrite after a raw object property",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const { surface } = { surface: exposed, ...{ surface: {} } }; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a raw spread overwrite after a safe object property",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const { surface } = { surface: {}, ...{ surface: exposed } }; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe property selected from a spread containing a raw sibling",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const { surface } = { ...{ surface: {}, raw: exposed } }; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "allows a safe array slot selected through a local container alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const values = [{}, exposed]; const [surface] = values; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a raw array slot selected through a local container alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const values = [{}, exposed]; const [, surface] = values; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe object rest selected through a local container alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const values = { raw: exposed, safe: {} }; const { raw, ...surface } = values; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a raw identifier assignment after declaration",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { let value; value = exposed; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw nullish identifier assignment",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { let value; value ??= exposed; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw boolean-or identifier assignment",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { let value = {}; value ||= exposed; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a raw boolean-and identifier assignment",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { let value = {}; value &&= exposed; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows an unconditional safe overwrite after a raw identifier value",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { let value = exposed; value = {}; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a conditional safe overwrite that can retain a raw identifier value",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal(flag: boolean) { let value = exposed; if (flag) value = {}; return value; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a self-assignment that retains a raw identifier value",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "let value = exposed; value = value; export { value };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a value captured before a later raw identifier assignment",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "let value = {}; const surface = value; value = exposed; export { surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a raw destructuring assignment after declaration",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export function reveal() { let surface; ({ surface } = { surface: exposed }); return surface; }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects a public static assignment through a class alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "class Surface {} const Alias = Surface; Alias.schema = exposed; export { Surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects Object.assign exposing raw schema on a class instance",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor() { Object.assign(this, { schema: exposed }); } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects Object.assign exposing raw schema through a local source alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor() { const source = { schema: exposed }; Object.assign(this, source); } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects Object.assign exposing raw schema through a spread source alias",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor() { const source = { schema: exposed }; Object.assign(this, { ...source }); } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows Object.assign when a source alias safely overwrites its raw property",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor() { const raw = { schema: exposed }; const source = { ...raw, schema: {} }; Object.assign(this, source); } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects Object.assign when a later source alias overwrites a safe property with raw schema",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { constructor() { const safe = { schema: {} }; const raw = { schema: exposed }; Object.assign(this, safe, raw); } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows a safe static overwrite after a raw class alias assignment",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "class Surface {} const Alias = Surface; Alias.schema = exposed; Alias.schema = {}; export { Surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects a conditional safe overwrite of a raw public class value",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "declare const flag: boolean; class Surface {} Surface.schema = exposed; if (flag) Surface.schema = {}; export { Surface };\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows private schema mutation with no public value output",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export class Surface { private schema: unknown; set() { this.schema = exposed; } ready() { return true; } }\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "rejects raw schema passed to an imported Boolean shadow",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          'import Boolean from "./identity";\n' +
          "export const surface = Boolean(exposed);\n",
        "packages/database/src/assets/identity.ts": "export default (value: unknown) => value;\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw schema passed to an ambient String shadow",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "declare function String(value: unknown): unknown;\n" +
          "export const surface = String(exposed);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "rejects raw schema passed to a local Number shadow",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "const Number = (value: unknown) => value; export const surface = Number(exposed);\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
      want: "domain barrel",
    },
    {
      name: "allows genuine global primitive conversion calls",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts":
          'import { assets as exposed } from "./schema";\n' +
          "export const safe = [Boolean(exposed), String(exposed), Number(exposed)];\n",
        "packages/database/src/assets/schema.ts": "export const assets = {};\n",
      },
    },
    {
      name: "fails closed without an uncaught RangeError on deeply nested valid syntax",
      files: {
        "packages/database/src/assets/index.ts": 'export * from "./bridge";\n',
        "packages/database/src/assets/bridge.ts": `export const surface = ${nestedParentheses("{}", 2_000)};\n`,
      },
      want: "architecture analysis failed",
      avoid: "RangeError",
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
      name: "rejects an external relative import of a physical owner schema",
      files: {
        "apps/server/src/contacts/service.ts":
          'import "../../../../packages/database/src/contacts/schema";\n',
        "packages/database/src/contacts/schema.ts": "export const contacts = {};\n",
      },
      want: "raw owner schema",
    },
    {
      name: "rejects a physical owner schema even in the Better Auth adapter",
      files: {
        "apps/server/src/auth/service.ts":
          'import "../../../../packages/database/src/auth/schema";\n',
        "packages/database/src/auth/schema.ts": "export const authSchema = {};\n",
      },
      want: "raw owner schema",
    },
    {
      name: "allows database internals to import their physical owner schema",
      files: {
        "packages/database/src/contacts/repository.ts":
          'import { contacts } from "./schema";\nvoid contacts;\n',
        "packages/database/src/contacts/schema.ts": "export const contacts = {};\n",
      },
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
      name: "rejects a parenthesized database orm element access outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          'declare const database: unknown;\nvoid database[("orm")];\n',
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
      name: "rejects aliased orm assignment destructuring outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          "declare const database: unknown;\n" +
          "let adapter;\n({ orm: adapter } = database);\nvoid adapter;\n",
      },
      want: "Better Auth adapter",
    },
    {
      name: "rejects shorthand orm assignment destructuring outside auth",
      files: {
        "apps/server/src/contacts/service.ts":
          "declare const database: unknown;\nlet orm;\n({ orm } = database);\nvoid orm;\n",
      },
      want: "Better Auth adapter",
    },
    {
      name: "allows orm assignment destructuring in the exact Better Auth adapter",
      files: {
        "apps/server/src/auth/service.ts":
          "declare const database: unknown;\n" +
          "let adapter;\nlet orm;\n" +
          "({ orm: adapter } = database);\n({ orm } = database);\n" +
          "void adapter;\nvoid orm;\n",
      },
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
      name: "unwraps nested transparent dynamic import expressions when detecting cycles",
      files: {
        "apps/client/src/a.ts": 'void import((("@/b" as string) satisfies string)!);\n',
        "apps/client/src/b.ts": 'import "@/a";\n',
      },
      want: "dependency cycle",
    },
    {
      name: "unwraps a type-asserted dynamic import when detecting cycles",
      files: {
        "apps/client/src/a.ts": 'void import(<string>"@/b");\n',
        "apps/client/src/b.ts": 'import "@/a";\n',
      },
      want: "dependency cycle",
    },
    {
      name: "does not evaluate dynamic imports hidden behind transparent wrappers",
      files: {
        "apps/client/src/a.ts": 'const target = "@/b";\nvoid import((target as string)!);\n',
        "apps/client/src/b.ts": 'import "@/a";\n',
      },
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
    {
      name: "allows a handwritten source file at exactly 500 actual lines",
      files: { "apps/server/src/exact-limit.ts": sourceLines(500) },
    },
    {
      name: "rejects a handwritten source file at 501 actual lines",
      files: { "apps/server/src/over-limit.ts": sourceLines(501) },
      want: "over 500 lines",
    },
    {
      name: "allows a handwritten declaration at exactly 500 actual lines",
      files: { "apps/server/src/exact-limit.d.ts": sourceLines(500) },
    },
    {
      name: "rejects a handwritten declaration at 501 actual lines",
      files: { "apps/server/src/over-limit.d.ts": sourceLines(501) },
      want: "over 500 lines",
    },
    {
      name: "checks dependencies in handwritten declarations",
      files: {
        "apps/server/src/leak.d.ts":
          'import type { contacts } from "../../../packages/database/src/contacts/schema";\n' +
          "export type Leak = typeof contacts;\n",
        "packages/database/src/contacts/schema.ts": "export const contacts = {};\n",
      },
      want: "raw owner schema",
    },
    {
      name: "allows a client TSX function at exactly 250 lines",
      files: { "apps/client/src/exact-function.tsx": componentLines(250) },
    },
    {
      name: "rejects a client TSX function at 251 lines",
      files: { "apps/client/src/over-function.tsx": componentLines(251) },
      want: "function-like node.*over 250 lines",
    },
    {
      name: "allows a client TSX constructor at exactly 250 lines",
      files: {
        "apps/client/src/exact-constructor.tsx": classMemberLines("constructor()", 250),
      },
    },
    {
      name: "rejects a client TSX constructor at 251 lines",
      files: {
        "apps/client/src/over-constructor.tsx": classMemberLines("constructor()", 251),
      },
      want: "function-like node.*over 250 lines",
    },
    {
      name: "allows a client TSX getter at exactly 250 lines",
      files: {
        "apps/client/src/exact-getter.tsx": classMemberLines("get value()", 250),
      },
    },
    {
      name: "rejects a client TSX getter at 251 lines",
      files: {
        "apps/client/src/over-getter.tsx": classMemberLines("get value()", 251),
      },
      want: "function-like node.*over 250 lines",
    },
    {
      name: "allows a client TSX setter at exactly 250 lines",
      files: {
        "apps/client/src/exact-setter.tsx": classMemberLines("set value(input: unknown)", 250),
      },
    },
    {
      name: "rejects a client TSX setter at 251 lines",
      files: {
        "apps/client/src/over-setter.tsx": classMemberLines("set value(input: unknown)", 251),
      },
      want: "function-like node.*over 250 lines",
    },
    {
      name: "allows a client TSX static block at exactly 250 lines",
      files: {
        "apps/client/src/exact-static-block.tsx": classMemberLines("static", 250),
      },
    },
    {
      name: "rejects a client TSX static block at 251 lines",
      files: {
        "apps/client/src/over-static-block.tsx": classMemberLines("static", 251),
      },
      want: "function-like node.*over 250 lines",
    },
    {
      name: "allows the documented shadcn sidebar exception",
      files: { "apps/client/src/components/ui/sidebar.tsx": sourceLines(700) },
    },
    {
      name: "rejects an arbitrary generated-looking source file at 501 lines",
      files: { "apps/client/src/example.gen.tsx": sourceLines(501) },
      want: "over 500 lines",
    },
    {
      name: "rejects an arbitrary generated-looking client TSX function at 251 lines",
      files: { "apps/client/src/example-function.gen.tsx": componentLines(251) },
      want: "function-like node.*over 250 lines",
    },
    {
      name: "excludes the exact TanStack generated route tree and declaration outputs",
      files: {
        "apps/client/src/routeTree.gen.ts": sourceLines(700),
        "apps/client/worker-configuration.d.ts": sourceLines(700),
      },
    },
    {
      name: "fails closed when TypeScript cannot parse a source file",
      files: { "apps/client/src/broken.tsx": "export function Broken( {\n" },
      want: "TypeScript could not parse",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const root = await fixture(scenario.files);
      try {
        const result = await run(root);
        if (scenario.want) {
          assert.notEqual(result.code, 0, `${result.stdout}\n${result.stderr}`);
          assert.match(result.stderr, new RegExp(scenario.want));
        } else {
          assert.equal(result.code, 0, result.stderr);
        }
        if (scenario.avoid) assert.doesNotMatch(result.stderr, new RegExp(scenario.avoid));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
