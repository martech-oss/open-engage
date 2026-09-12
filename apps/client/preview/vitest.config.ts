import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { previewRoot, previewAliases, previewShell } from "./config";
export default defineConfig({
  root: previewRoot,
  plugins: [previewShell(), react()],
  resolve: { alias: previewAliases },
  test: { environment: "happy-dom", include: ["*.smoke.tsx", "*.smoke.ts"], testTimeout: 15000 },
});
