import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { generatedSourcePaths, generatedDeclarationPaths } from "./policy.mjs";

export async function collectWorkspaceFiles(root) {
  const files = [];
  for (const directory of [resolve(root, "apps"), resolve(root, "packages")]) {
    await collectSourceFiles(root, directory, files);
  }
  return files;
}

async function collectSourceFiles(root, directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["dist", "node_modules", ".wrangler"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(root, path, output);
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !generatedSourcePaths.has(relative(root, path)) &&
      !generatedDeclarationPaths.has(relative(root, path))
    )
      output.push(path);
  }
}

export async function readPackageSpecifiers(root) {
  // Maps a package's bare specifier (e.g. "@openengage/core/contacts") to the
  // source file it resolves to, read straight from each package.json's
  // "exports" map so the cycle detector can follow cross-package imports the
  // same way it already follows relative ones.
  const packageSpecifiers = new Map();
  for (const packageDir of await readdir(resolve(root, "packages"), { withFileTypes: true })) {
    if (!packageDir.isDirectory()) continue;
    const packageJsonPath = resolve(root, "packages", packageDir.name, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8").catch(() => "{}"));
    if (!packageJson.name || !packageJson.exports) continue;
    for (const [subpath, target] of Object.entries(packageJson.exports)) {
      if (typeof target !== "string") continue;
      const specifier =
        subpath === "." ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`;
      packageSpecifiers.set(specifier, resolve(root, "packages", packageDir.name, target));
    }
  }

  return packageSpecifiers;
}
