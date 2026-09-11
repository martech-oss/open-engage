import { dirname, relative, resolve } from "node:path";

// Resolution uses only the current run's source inventory and parsed facts.
export function createModuleResolver({ root, files, sourceFacts, packageSpecifiers }) {
  const sourceSet = new Set(files);
  const databaseRootBarrel = resolve(root, "packages/database/src/index.ts");
  const databaseClientEntrypoint = resolve(root, "packages/database/src/client.ts");
  const databaseTestingEntrypoint = resolve(root, "packages/database/src/testing.ts");
  const databaseEntrypoints = new Map([
    [databaseRootBarrel, "root"],
    [databaseClientEntrypoint, "client"],
    [resolve(root, "packages/database/src/schema.ts"), "schema"],
    [databaseTestingEntrypoint, "testing"],
  ]);
  const databaseSpecifiers = new Map([
    ["@openengage/database", "root"],
    ["@openengage/database/client", "client"],
    ["@openengage/database/schema", "schema"],
    ["@openengage/database/testing", "testing"],
  ]);
  function resolveModuleSpecifier(importer, specifier) {
    if (specifier.startsWith(".")) return resolveImport(importer, specifier);
    if (specifier.startsWith("@/") && relative(root, importer).startsWith("apps/client/src/")) {
      return resolveImport(
        resolve(root, "apps/client/src/__alias_importer__.ts"),
        `./${specifier.slice(2)}`,
      );
    }
    const packageTarget = packageSpecifiers.get(specifier);
    return packageTarget && sourceSet.has(packageTarget) ? packageTarget : undefined;
  }

  function resolveDatabaseEntrypoints(importer, edge) {
    const directSpecifier = databaseSpecifiers.get(edge.specifier);
    if (directSpecifier) return new Set([directSpecifier]);

    const target = resolveModuleSpecifier(importer, edge.specifier);
    return target ? collectDatabaseEntrypoints(target) : new Set();
  }

  function collectDatabaseEntrypoints(file) {
    const entrypoints = new Set();
    const visited = new Set();

    function collect(current) {
      if (visited.has(current)) return;
      visited.add(current);

      const directEntrypoint = databaseEntrypoints.get(current);
      if (directEntrypoint) {
        entrypoints.add(directEntrypoint);
        return;
      }
      for (const edge of sourceFacts.get(current)?.edges ?? []) {
        if (edge.kind !== "export" || edge.viaCallableOutput) continue;
        const directSpecifier = databaseSpecifiers.get(edge.specifier);
        if (directSpecifier) {
          entrypoints.add(directSpecifier);
          continue;
        }
        const target = resolveModuleSpecifier(current, edge.specifier);
        if (target) collect(target);
      }
    }

    collect(file);
    return entrypoints;
  }

  function collectReexportTargets(file) {
    const targets = new Set();
    const visited = new Set([file]);

    function collect(current) {
      for (const edge of sourceFacts.get(current)?.edges ?? []) {
        if (edge.kind !== "export") continue;
        const target = resolveModuleSpecifier(current, edge.specifier);
        if (!target) continue;
        targets.add(target);
        if (visited.has(target)) continue;
        visited.add(target);
        collect(target);
      }
    }

    collect(file);
    return targets;
  }

  function resolveImport(importer, specifier) {
    const base = resolve(dirname(importer), specifier);
    const explicitTypeScriptFile = /\.tsx?$/.test(base) ? [base] : [];
    const emittedJavaScriptSource = /\.[cm]?js$/.test(base)
      ? [base.replace(/\.[cm]?js$/, ".ts"), base.replace(/\.[cm]?js$/, ".tsx")]
      : [];
    for (const candidate of new Set([
      ...explicitTypeScriptFile,
      `${base}.ts`,
      `${base}.tsx`,
      ...emittedJavaScriptSource,
      resolve(base, "index.ts"),
      resolve(base, "index.tsx"),
    ])) {
      if (sourceSet.has(candidate)) return candidate;
    }
    return undefined;
  }

  function isDatabaseOwnerSchema(file) {
    return /^packages\/database\/src\/.+\/schema\.tsx?$/.test(relative(root, file));
  }

  return {
    databaseRootBarrel,
    databaseClientEntrypoint,
    databaseTestingEntrypoint,
    resolveModuleSpecifier,
    resolveDatabaseEntrypoints,
    collectReexportTargets,
    isDatabaseOwnerSchema,
  };
}
