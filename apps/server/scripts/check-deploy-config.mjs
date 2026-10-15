import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { deployConfigProblems } from "./deploy-config.mjs";

// Runs before `wrangler deploy`, against the same config and environment it will use.
const { unstable_readConfig } = createRequire(import.meta.url)("wrangler");
const config = unstable_readConfig({
  config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
  ...(process.env.CLOUDFLARE_ENV ? { env: process.env.CLOUDFLARE_ENV } : {}),
});
const problems = deployConfigProblems(config.vars);
if (problems.length > 0) {
  console.error("Refusing to deploy the server Worker:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
