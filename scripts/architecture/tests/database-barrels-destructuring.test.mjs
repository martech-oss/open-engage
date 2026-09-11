import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: database-barrels-destructuring", [
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
]);
