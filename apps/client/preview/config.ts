import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";
export const previewRoot = fileURLToPath(new URL("./", import.meta.url));
export const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
export const previewAliases = [
  { find: "@tanstack/react-start/server", replacement: `${previewRoot}mock-start.ts` },
  { find: "@tanstack/react-start", replacement: `${previewRoot}mock-start.ts` },
  { find: "@/lib/orpc", replacement: `${previewRoot}mock-orpc.ts` },
  { find: "@/auth-client", replacement: `${previewRoot}mock-auth.ts` },
  { find: "@", replacement: sourceRoot },
];
// Use the actual generated route tree and loaders. Only replace the SSR HTML shell.
export function previewShell(): Plugin {
  return {
    name: "preview-shell",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/routeTree.gen.ts"))
        return code.replace(
          /(['"])\.\/routes\/__root\1/g,
          JSON.stringify(`${previewRoot}preview-root.tsx`),
        );
    },
  };
}
