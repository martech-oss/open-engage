import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    flue(),
    cloudflare({
      config: flueWorkerConfig(),
      inspectorPort: 9230,
      remoteBindings: false,
    }),
  ],
  server: {
    // Flue's historical `flue dev` port. Vite's 5173 is used by the client.
    port: 3583,
    strictPort: true,
  },
});
