import { runScenarios, sourceLines, componentLines, classMemberLines } from "./helpers.mjs";

await runScenarios("architecture: size-limits", [
  ...[
    "apps/client/src/features/automations/automation-ai-sheet/controller.ts",
    "apps/client/src/features/projects/clone-panel/controller.ts",
  ].flatMap((path) => [
    {
      name: `allows extracted controller ${path} at 250 function lines`,
      files: { [path]: componentLines(250) },
    },
    {
      name: `rejects extracted controller ${path} above 250 function lines`,
      files: { [path]: componentLines(251) },
      want: "function-like node.*over 250 lines",
    },
    {
      name: `allows extracted controller ${path} at 500 file lines`,
      files: { [path]: sourceLines(500) },
    },
    {
      name: `rejects extracted controller ${path} above 500 file lines`,
      files: { [path]: sourceLines(501) },
      want: "over 500 lines",
    },
  ]),
  {
    name: "does not expand the controller ceiling to unrelated client TS modules",
    files: { "apps/client/src/lib/example.ts": componentLines(251) },
  },
  {
    name: "allows focused Task 6 files and functions at their ratchet limits",
    files: {
      "apps/client/src/features/segments/segment-builder.tsx": componentLines(120),
      "apps/client/src/features/emails/email-block-editor.tsx": sourceLines(250),
    },
  },
  {
    name: "rejects a focused Task 6 file above 250 lines",
    files: {
      "apps/client/src/features/emails/email-block-editor.tsx": sourceLines(251),
    },
    want: "Task 6 hotspot.*over 250 lines",
  },
  {
    name: "rejects a focused Task 6 function above 120 lines",
    files: {
      "apps/client/src/features/segments/segment-builder.tsx": componentLines(121),
    },
    want: "Task 6 hotspot function.*over 120 lines",
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
]);
