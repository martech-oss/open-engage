import { resolve } from "node:path";

import { checkDependencyCycles } from "./cycles.mjs";
import { collectWorkspaceFiles, readPackageSpecifiers } from "./files.mjs";
import { createModuleResolver } from "./resolution.mjs";
import { checkRules } from "./rules.mjs";
import { extractSourceFacts } from "./syntax.mjs";

/**
 * Inspect one workspace. Every inventory, parser session, graph, and analysis
 * cache belongs to this invocation; importing this module has no CLI effects.
 * @param {{ root: string }} options
 * @returns {Promise<{ fileCount: number, violations: string[] }>}
 */
export async function runArchitectureCheck({ root }) {
  root = resolve(root);
  const files = await collectWorkspaceFiles(root);
  let sourceFacts;
  try {
    sourceFacts = extractSourceFacts(root, files);
  } catch (error) {
    const diagnostic =
      error instanceof Error && error.message.startsWith("TypeScript could not parse")
        ? error.message
        : error instanceof Error && error.name !== "RangeError"
          ? `architecture analysis failed safely: ${error.message}`
          : "architecture analysis failed safely for deeply nested or invalid TypeScript";
    return { fileCount: files.length, violations: [diagnostic] };
  }
  const packageSpecifiers = await readPackageSpecifiers(root);
  const resolver = createModuleResolver({ root, files, sourceFacts, packageSpecifiers });
  const { graph, violations } = checkRules({ root, files, sourceFacts, resolver });
  violations.push(...checkDependencyCycles({ root, files, graph }));
  return { fileCount: files.length, violations };
}
