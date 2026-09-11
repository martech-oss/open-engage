import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: database-barrels-callables", [
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
      "packages/database/src/assets/bridge.ts": "export function recurse() { return recurse(); }\n",
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
]);
