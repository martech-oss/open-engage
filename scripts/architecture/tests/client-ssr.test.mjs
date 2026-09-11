import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: client-ssr", [
  {
    name: "rejects route-local SSR opt-outs",
    files: {
      "apps/client/src/routes/_app.contacts.tsx":
        "declare function createFileRoute(path: string): (options: unknown) => unknown;\n" +
        'export const Route = createFileRoute("/_app/contacts")({ ssr: false });\n',
    },
    want: "route ssr:false",
  },
  {
    name: "rejects a shorthand aliased route SSR opt-out",
    files: {
      "apps/client/src/routes/_app.contacts.tsx":
        "declare function createFileRoute(path: string): (options: unknown) => unknown;\n" +
        "const ssr = false;\n" +
        'export const Route = createFileRoute("/_app/contacts")({ ssr });\n',
    },
    want: "route ssr:false",
  },
  {
    name: "rejects a spread aliased route SSR opt-out",
    files: {
      "apps/client/src/routes/_app.contacts.tsx":
        "declare function createFileRoute(path: string): (options: unknown) => unknown;\n" +
        "const disabled = false;\n" +
        "const routeOptions = { ssr: disabled };\n" +
        'export const Route = createFileRoute("/_app/contacts")({ ...routeOptions });\n',
    },
    want: "route ssr:false",
  },
  {
    name: "allows the word ssr false outside a route option",
    files: {
      "apps/client/src/features/contacts/labels.ts":
        'export const documentation = "route ssr: false is forbidden";\n',
    },
  },
]);
