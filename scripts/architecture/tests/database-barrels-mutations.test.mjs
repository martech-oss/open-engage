import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: database-barrels-mutations", [
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
]);
