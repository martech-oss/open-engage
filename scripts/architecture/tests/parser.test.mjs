import { runScenarios, nestedParentheses } from "./helpers.mjs";

await runScenarios("architecture: parser", [
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
    name: "fails closed when TypeScript cannot parse a source file",
    files: { "apps/client/src/broken.tsx": "export function Broken( {\n" },
    want: "TypeScript could not parse",
  },
]);
