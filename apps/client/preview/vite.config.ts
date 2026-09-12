import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { previewRoot, previewAliases, previewShell } from "./config";
export default defineConfig({
  root: previewRoot,
  plugins: [previewShell(), tailwind(), react()],
  resolve: { alias: previewAliases },
  server: { host: "127.0.0.1", port: 5182, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
