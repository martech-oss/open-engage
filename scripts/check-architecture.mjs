import { resolve } from "node:path";

import { runArchitectureCheck } from "./architecture/index.mjs";

const rootFlag = process.argv.indexOf("--root");
const root =
  rootFlag >= 0 && process.argv[rootFlag + 1]
    ? resolve(process.argv[rootFlag + 1])
    : resolve(import.meta.dirname, "..");
const { fileCount, violations } = await runArchitectureCheck({ root });

if (violations.length > 0) {
  process.stderr.write(
    `Architecture violations:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `architecture: ${fileCount} source files checked; no forbidden dependencies or cycles.\n`,
  );
}
