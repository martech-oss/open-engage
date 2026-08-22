import { fileURLToPath, URL } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function splitClientVendorChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");
  if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(normalizedId)) {
    return "vendor-react";
  }
  if (normalizedId.includes("/node_modules/better-auth/")) {
    return "vendor-auth";
  }
  if (normalizedId.includes("/node_modules/zod/")) {
    return "vendor-zod";
  }
  return undefined;
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  environments: {
    client: {
      build: {
        manifest: true,
        rollupOptions: {
          output: {
            manualChunks: splitClientVendorChunk,
          },
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    cloudflare({
      configPath: "./wrangler.jsonc",
      auxiliaryWorkers: [
        {
          configPath: "../server/wrangler.jsonc",
        },
      ],
      inspectorPort: 9229,
      viteEnvironment: { name: "ssr" },
    }),
    tanstackStart(),
    react(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
