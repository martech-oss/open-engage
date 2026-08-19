import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

// Files allowed to stay over 600 lines: a ratchet, like drizzleImportAllowlist
// above. Shrink (via splitting) as files come back under the line, never grow
// it for a new large file - split that file instead.
const largeFileAllowlist = [
  "apps/client/src/components/ui/sidebar.tsx",
  "packages/database/src/deals/repository.ts",
];

// These files are intentionally split by domain responsibility. Their lower
// limits prevent the former all-in-one project brief schema/contract from
// gradually growing back below the repository-wide 600-line ceiling.
const focusedFileLineLimits = new Map([
  ["packages/core/src/projects/definition.ts", 200],
  ["packages/core/src/projects/dto.ts", 200],
  ["packages/core/src/projects/generation.ts", 100],
  ["packages/core/src/projects/workflow.ts", 220],
  ["packages/orpc/src/projects/contract.ts", 250],
]);
const projectBriefFileLineLimit = 550;

// Canonical strings from packages/orpc/src/shared/errors.ts. Keep in sync by
// hand - this script has no import access to that module's runtime values.
const sharedErrorMessages = [
  "ログインが必要です",
  "APIキーが無効です",
  "利用可能なワークスペースがありません",
  "許可されていないOriginです",
  "この操作を行う権限がありません",
  "施策ブリーフが見つかりません",
  "承認済みの施策ブリーフが必要です",
  "施策ブリーフのrevisionが一致しません",
  "現在の状態ではこの操作を実行できません",
  "施策ブリーフが更新されています。最新の内容を再読み込みしてください",
  "担当者または承認者が無効です",
];

// apps/server/src should read/write through packages/database repositories.
// This allowlist is a ratchet: shrink it as files migrate to a repository,
// never grow it for a new raw-drizzle call site.
const drizzleImportAllowlist = [];

const rootFlag = process.argv.indexOf("--root");
const root =
  rootFlag >= 0 && process.argv[rootFlag + 1]
    ? resolve(process.argv[rootFlag + 1])
    : resolve(import.meta.dirname, "..");
const sourceRoots = [resolve(root, "apps"), resolve(root, "packages")];
const files = [];
for (const sourceRoot of sourceRoots) await collectSourceFiles(sourceRoot, files);

const sourceSet = new Set(files);
const graph = new Map(files.map((file) => [file, []]));
const violations = [];

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

for (const file of files) {
  const source = await readFile(file, "utf8");
  const imports = [
    ...source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  const workspacePath = relative(root, file);
  const isTest = isTestFile(workspacePath);
  const isBetterAuthAdapter = workspacePath === "apps/server/src/auth/service.ts";

  if (imports.includes("@openengage/database")) {
    violations.push(
      `${workspacePath}: import an owned @openengage/database subpath, not the database package root`,
    );
  }
  if (!isTest && imports.includes("@openengage/database/testing")) {
    violations.push(
      `${workspacePath}: production code must not use the database testing entrypoint`,
    );
  }
  if (imports.includes("@openengage/database/schema") && !isBetterAuthAdapter) {
    violations.push(
      `${workspacePath}: only the exact Better Auth adapter may import the database schema entrypoint`,
    );
  }
  if (
    workspacePath.startsWith("apps/server/src/") &&
    !isTest &&
    !isBetterAuthAdapter &&
    /\.\s*orm\b/.test(source)
  ) {
    violations.push(`${workspacePath}: only the exact Better Auth adapter may access database.orm`);
  }
  if (
    isBetterAuthAdapter &&
    imports.includes("@openengage/database/schema") &&
    !imports.includes("@openengage/database/client")
  ) {
    violations.push(
      `${workspacePath}: the Better Auth adapter must import createDatabase from @openengage/database/client`,
    );
  }

  if (
    /^(?:packages\/database\/src\/web\/(?:asset-|project-|campaign-repository)|apps\/server\/src\/web\/(?:asset-|project-))/.test(
      workspacePath,
    )
  ) {
    violations.push(
      `${workspacePath}: asset/project implementation must live in its owning domain`,
    );
  }
  if (
    workspacePath === "packages/database/src/web/public-repository.ts" &&
    /\bPublicAsset(?:Repository|Record)\b/.test(source)
  ) {
    violations.push(
      `${workspacePath}: public asset persistence must live in the database assets domain`,
    );
  }
  if (
    workspacePath === "packages/database/src/contacts/score-schema.ts" ||
    imports.some((specifier) => /(?:^|\/)contacts\/score-schema$/.test(specifier))
  ) {
    violations.push(`${workspacePath}: score events belong to scoring/schema.ts`);
  }
  const databaseDomainBarrel = /^packages\/database\/src\/([^/]+)\/index\.ts$/.exec(workspacePath);
  if (databaseDomainBarrel) {
    const ownerRoot = `packages/database/src/${databaseDomainBarrel[1]}/`;
    for (const specifier of imports.filter((value) => value.startsWith("."))) {
      const target = resolveImport(file, specifier);
      const targetPath = target ? relative(root, target) : "";
      if (!targetPath.startsWith(ownerRoot) || /(?:^|\/)schema\.tsx?$/.test(targetPath)) {
        violations.push(
          `${workspacePath}: database domain barrel must export owned repositories/types only`,
        );
      }
    }
  }

  if (
    (workspacePath.startsWith("packages/core/src/") ||
      workspacePath.startsWith("packages/database/src/") ||
      workspacePath.startsWith("apps/server/src/channels/") ||
      workspacePath.startsWith("apps/server/src/rendering/")) &&
    imports.includes("@openengage/orpc")
  ) {
    violations.push(`${workspacePath}: lower-level module must not import @openengage/orpc`);
  }
  if (
    workspacePath.startsWith("packages/core/src/projects/") &&
    imports.some((value) =>
      /^(?:\.\.\/(?:automations|segments)(?:\/|$)|@openengage\/core\/(?:automations|segments)(?:\/|$))/.test(
        value,
      ),
    )
  ) {
    violations.push(
      `${workspacePath}: projects domain must not depend on Segment or Automation catalogs; ` +
        `compose cross-domain context in packages/core/src/agents instead`,
    );
  }
  if (
    workspacePath.startsWith("apps/client/src/") &&
    extname(file) === ".tsx" &&
    /\b(orpc|orpcQuery)\.[a-z]/.test(source)
  ) {
    violations.push(`${workspacePath}: components must call feature APIs or query/mutation hooks`);
  }

  if (
    !workspacePath.startsWith("packages/core/src/") &&
    /export\s+\*\s+from\s+["']@openengage\/(?:core|orpc)["']/.test(source)
  ) {
    violations.push(
      `${workspacePath}: must not re-export the entire @openengage/core or @openengage/orpc surface`,
    );
  }
  if (!workspacePath.startsWith("packages/core/src/") && imports.includes("@openengage/core")) {
    violations.push(
      `${workspacePath}: import from @openengage/core/<domain>, not the package root`,
    );
  }

  if (
    workspacePath !== "packages/orpc/src/shared/errors.ts" &&
    !/\.test\.tsx?$/.test(workspacePath) &&
    sharedErrorMessages.some((message) => source.includes(message))
  ) {
    violations.push(
      `${workspacePath}: reuse a workspaceErrors/forbiddenError message from ` +
        `packages/orpc/src/shared/errors.ts instead of hard-coding it`,
    );
  }

  if (
    workspacePath.startsWith("packages/database/src/") &&
    workspacePath !== "packages/database/src/shared/database-utils.ts" &&
    source.includes("new Date().toISOString()")
  ) {
    violations.push(
      `${workspacePath}: use nowIso() from shared/database-utils instead of new Date().toISOString()`,
    );
  }
  if (
    workspacePath.startsWith("packages/database/src/") &&
    workspacePath !== "packages/database/src/client.ts" &&
    workspacePath !== "packages/database/src/shared/repository-base.ts" &&
    source.includes("createDatabase(")
  ) {
    violations.push(
      `${workspacePath}: only client.ts and shared/repository-base.ts may call createDatabase(); ` +
        `extend DatabaseRepository/WorkspaceRepository instead`,
    );
  }

  if (
    workspacePath.startsWith("apps/server/src/") &&
    !/\.test\.tsx?$/.test(workspacePath) &&
    !drizzleImportAllowlist.includes(workspacePath) &&
    imports.some((value) => value === "drizzle-orm" || value.startsWith("drizzle-orm/"))
  ) {
    violations.push(
      `${workspacePath}: read/write through a packages/database repository instead of ` +
        `importing drizzle-orm directly (see drizzleImportAllowlist in this script)`,
    );
  }

  for (const specifier of imports.filter((value) => value.startsWith("."))) {
    const target = resolveImport(file, specifier);
    if (target) {
      graph.get(file).push(target);
      enforceServerFolderDirection(workspacePath, relative(root, target), violations);
    }
  }
  if (workspacePath.startsWith("apps/client/src/")) {
    for (const specifier of imports.filter((value) => value.startsWith("@/"))) {
      const target = resolveImport(
        resolve(root, "apps/client/src/__alias_importer__.ts"),
        `./${specifier.slice(2)}`,
      );
      if (target) graph.get(file).push(target);
      else violations.push(`${workspacePath}: unresolved client alias ${specifier}`);
    }
  }
  for (const specifier of imports) {
    const target = packageSpecifiers.get(specifier);
    if (target && sourceSet.has(target)) graph.get(file).push(target);
  }

  if (!largeFileAllowlist.includes(workspacePath) && source.split("\n").length > 600) {
    violations.push(
      `${workspacePath}: over 600 lines - split it, or add it to largeFileAllowlist in this ` +
        `script if it's a vendored/generated file`,
    );
  }
  const focusedLimit = focusedFileLineLimits.get(workspacePath);
  if (focusedLimit && source.split("\n").length > focusedLimit) {
    violations.push(
      `${workspacePath}: over focused ${focusedLimit}-line project brief ratchet - split by ` +
        `responsibility instead of growing the hotspot`,
    );
  }
  if (
    workspacePath.includes("project-brief") &&
    source.split("\n").length > projectBriefFileLineLimit
  ) {
    violations.push(
      `${workspacePath}: over ${projectBriefFileLineLimit}-line project brief feature ratchet - ` +
        `keep the refactored command, query, resource, form, and view responsibilities split`,
    );
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
for (const file of files) visit(file);

if (violations.length > 0) {
  process.stderr.write(
    `Architecture violations:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `architecture: ${files.length} source files checked; no forbidden dependencies or cycles.\n`,
  );
}

async function collectSourceFiles(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["dist", "node_modules", ".wrangler"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(path, output);
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".gen.ts")
    )
      output.push(path);
  }
}

function resolveImport(importer, specifier) {
  const base = resolve(dirname(importer), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/, ".ts"),
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    if (sourceSet.has(candidate)) return candidate;
  }
  return undefined;
}

function isTestFile(workspacePath) {
  return /(?:^|\/)test(?:\/|$)|\.(?:test|spec)\.tsx?$/.test(workspacePath);
}

function enforceServerFolderDirection(importer, target, output) {
  const match = /^apps\/server\/src\/(platform|rendering|assets|web)\//.exec(importer);
  if (!match) return;
  const owner = match[1];
  if (owner === "platform" && target.startsWith("apps/server/src/channels/")) {
    output.push(`${importer}: platform must not import channels`);
  }
  if (
    (owner === "rendering" || owner === "assets" || owner === "web") &&
    target.startsWith("apps/server/src/public/")
  ) {
    output.push(`${importer}: ${owner} must not import public`);
  }
}

function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map((item) => relative(root, item)).join(" -> ");
    violations.push(`dependency cycle: ${cycle}`);
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file)) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}
