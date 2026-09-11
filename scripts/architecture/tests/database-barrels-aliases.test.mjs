import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: database-barrels-aliases", [
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
]);
