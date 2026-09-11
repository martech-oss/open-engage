import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: module-resolution", [
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
]);
