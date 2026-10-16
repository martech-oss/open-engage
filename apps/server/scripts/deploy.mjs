import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deployConfigProblems, deployTarget } from "./deploy-config.mjs";

// Checks the exact config and environment `wrangler deploy` will use, from the
// same arguments, and only then hands those arguments to Wrangler.
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const target = deployTarget(args, process.env.CLOUDFLARE_ENV);
const require = createRequire(import.meta.url);
const { unstable_readConfig } = require("wrangler");
const config = unstable_readConfig({
  config: resolve(serverRoot, target.config ?? "wrangler.jsonc"),
  ...(target.environment ? { env: target.environment } : {}),
});
const problems = deployConfigProblems(config.vars);
if (problems.length > 0) {
  console.error("Refusing to deploy the server Worker:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
const wrangler = join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const result = spawnSync(process.execPath, [wrangler, "deploy", ...args], {
  cwd: serverRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
