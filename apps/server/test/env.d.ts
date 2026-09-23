import type { D1Migration } from "cloudflare:test";

import type { RuntimeSecrets } from "../src/env";

// Bindings that vitest.config.ts adds on top of wrangler.test.jsonc, so the
// test `env` satisfies RuntimeEnv like the deployed Worker's env does.
declare global {
  namespace Cloudflare {
    interface Env extends RuntimeSecrets {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
