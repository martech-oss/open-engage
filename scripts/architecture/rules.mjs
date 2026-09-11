import { extname, relative } from "node:path";

import {
  handwrittenFileLineLimit,
  clientFunctionLineLimit,
  task6HotspotFileLineLimit,
  task6HotspotFunctionLineLimit,
  handwrittenLineLimitExceptions,
  focusedFileLineLimits,
  sharedErrorMessages,
  drizzleImportAllowlist,
  routeSsrFalseAllowlist,
  migratedCommandRouters,
} from "./policy.mjs";

export function checkRules({ root, files, sourceFacts, resolver }) {
  const violations = [];
  const graph = new Map(files.map((file) => [file, []]));
  const {
    databaseRootBarrel,
    databaseClientEntrypoint,
    databaseTestingEntrypoint,
    resolveModuleSpecifier,
    resolveDatabaseEntrypoints,
    collectReexportTargets,
    isDatabaseOwnerSchema,
  } = resolver;
  for (const file of files) {
    const {
      edges,
      functionLikeSpans,
      hasClientRolePermissionLogic,
      hasRpcTransportSetup,
      hasRouteSsrDisabled,
      hasStaticOrmAccess,
      source,
    } = sourceFacts.get(file);
    const imports = edges.map(({ specifier }) => specifier);
    const workspacePath = relative(root, file);
    const isTest = isTestFile(workspacePath);
    const isBetterAuthAdapter = workspacePath === "apps/server/src/auth/service.ts";
    const importedDatabaseEntrypoints = new Set(
      edges
        .filter((edge) => !edge.viaImportedBinding)
        .flatMap((edge) => [...resolveDatabaseEntrypoints(file, edge)]),
    );
    const importsRawOwnerSchema = edges.some((edge) => {
      if (edge.viaImportedBinding) return false;
      const target = resolveModuleSpecifier(file, edge.specifier);
      return target && isDatabaseOwnerSchema(target);
    });

    if (file !== databaseTestingEntrypoint && importedDatabaseEntrypoints.has("root")) {
      violations.push(
        `${workspacePath}: import an owned @openengage/database subpath, not the database package root`,
      );
    }
    if (!isTest && importedDatabaseEntrypoints.has("testing")) {
      violations.push(
        `${workspacePath}: production code must not use the database testing entrypoint`,
      );
    }
    if (
      importedDatabaseEntrypoints.has("schema") &&
      file !== databaseRootBarrel &&
      file !== databaseClientEntrypoint &&
      !isBetterAuthAdapter
    ) {
      violations.push(
        `${workspacePath}: only the exact Better Auth adapter may import the database schema entrypoint`,
      );
    }
    if (!workspacePath.startsWith("packages/database/src/") && importsRawOwnerSchema) {
      violations.push(
        `${workspacePath}: database raw owner schema internals must not be imported outside the database package`,
      );
    }
    if (
      migratedCommandRouters.has(workspacePath) &&
      edges.some(
        (edge) =>
          edge.runtime &&
          (edge.kind === "import" || edge.kind === "export" || edge.kind === "dynamic-import") &&
          (edge.specifier === "@openengage/database" ||
            edge.specifier.startsWith("@openengage/database/")),
      )
    ) {
      violations.push(
        `${workspacePath}: migrated command router must not runtime import @openengage/database; ` +
          `delegate persistence to its application service`,
      );
    }
    if (
      workspacePath.startsWith("apps/server/src/contacts/") &&
      !isTest &&
      edges.some((edge) => {
        const target = resolveModuleSpecifier(file, edge.specifier);
        return target && relative(root, target).startsWith("apps/server/src/runtime/");
      })
    ) {
      violations.push(
        `${workspacePath}: contacts domain must not depend on runtime composition; ` +
          `wire cross-domain event orchestration from apps/server/src/runtime instead`,
      );
    }
    if (
      workspacePath.startsWith("apps/server/src/") &&
      !isTest &&
      !isBetterAuthAdapter &&
      hasStaticOrmAccess
    ) {
      violations.push(
        `${workspacePath}: only the exact Better Auth adapter may access database.orm`,
      );
    }
    if (
      isBetterAuthAdapter &&
      importedDatabaseEntrypoints.has("schema") &&
      !importedDatabaseEntrypoints.has("client")
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
    const databaseDomainBarrel = /^packages\/database\/src\/([^/]+)\/index\.ts$/.exec(
      workspacePath,
    );
    if (databaseDomainBarrel) {
      const ownerRoot = `packages/database/src/${databaseDomainBarrel[1]}/`;
      const barrelTargets = new Set([
        ...edges.map((edge) => resolveModuleSpecifier(file, edge.specifier)).filter(Boolean),
        ...collectReexportTargets(file),
      ]);
      for (const target of barrelTargets) {
        const targetPath = relative(root, target);
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
      violations.push(
        `${workspacePath}: components must call feature APIs or query/mutation hooks`,
      );
    }
    if (
      workspacePath.startsWith("apps/client/src/routes/") &&
      hasRouteSsrDisabled &&
      !routeSsrFalseAllowlist.has(workspacePath)
    ) {
      violations.push(
        `${workspacePath}: route ssr:false requires an explicit architecture allowlist entry`,
      );
    }
    if (workspacePath.startsWith("apps/client/src/") && !isTest && hasClientRolePermissionLogic) {
      violations.push(
        `${workspacePath}: derive authorization from server-provided capabilities, not client role comparisons or permission sets`,
      );
    }
    if (
      workspacePath.startsWith("apps/client/src/") &&
      workspacePath !== "apps/client/src/lib/orpc.ts" &&
      !isTest &&
      hasRpcTransportSetup
    ) {
      violations.push(
        `${workspacePath}: RPCLink and transport setup belong in the shared client oRPC module`,
      );
    }

    if (
      !workspacePath.startsWith("packages/core/src/") &&
      edges.some(
        ({ exportsAll, kind, specifier }) =>
          kind === "export" &&
          exportsAll &&
          (specifier === "@openengage/core" || specifier === "@openengage/orpc"),
      )
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

    for (const { specifier } of edges) {
      const target = resolveModuleSpecifier(file, specifier);
      if (target) {
        graph.get(file).push(target);
        enforceServerFolderDirection(workspacePath, relative(root, target), violations);
      } else if (workspacePath.startsWith("apps/client/src/") && specifier.startsWith("@/")) {
        violations.push(`${workspacePath}: unresolved client alias ${specifier}`);
      }
    }

    const lineCount = actualLineCount(source);
    if (
      !handwrittenLineLimitExceptions.has(workspacePath) &&
      lineCount > handwrittenFileLineLimit
    ) {
      violations.push(
        `${workspacePath}: over ${handwrittenFileLineLimit} lines (${lineCount}) - split it by responsibility`,
      );
    }
    if (
      workspacePath.startsWith("apps/client/src/") &&
      extname(file) === ".tsx" &&
      !handwrittenLineLimitExceptions.has(workspacePath)
    ) {
      for (const span of functionLikeSpans) {
        if (span.lineCount <= clientFunctionLineLimit) continue;
        violations.push(
          `${workspacePath}:${span.startLine}: function-like node is ${span.lineCount} lines, ` +
            `over ${clientFunctionLineLimit} lines - extract focused UI responsibilities`,
        );
      }
    }
    const focusedLimit = focusedFileLineLimits.get(workspacePath);
    if (focusedLimit && lineCount > focusedLimit) {
      violations.push(
        `${workspacePath}: over focused ${focusedLimit}-line project brief ratchet - split by ` +
          `responsibility instead of growing the hotspot`,
      );
    }
    if (!isTest && isTask6Hotspot(workspacePath)) {
      if (lineCount > task6HotspotFileLineLimit) {
        violations.push(
          `${workspacePath}: Task 6 hotspot is ${lineCount} lines, over ${task6HotspotFileLineLimit} lines`,
        );
      }
      for (const span of functionLikeSpans) {
        if (span.lineCount <= task6HotspotFunctionLineLimit) continue;
        violations.push(
          `${workspacePath}:${span.startLine}: Task 6 hotspot function is ${span.lineCount} lines, ` +
            `over ${task6HotspotFunctionLineLimit} lines`,
        );
      }
    }
  }
  return { graph, violations };
}

function isTask6Hotspot(workspacePath) {
  return (
    /^apps\/client\/src\/components\/data-table(?:-[^/]+)?\.(?:ts|tsx)$/.test(workspacePath) ||
    /^apps\/client\/src\/features\/(?:companies|scoring|settings)\//.test(workspacePath) ||
    /^apps\/client\/src\/features\/contacts\/(?:contact-(?:drawer|profile|score|timeline))/.test(
      workspacePath,
    ) ||
    /^apps\/client\/src\/features\/emails\/email-(?:block|document)/.test(workspacePath) ||
    /^apps\/client\/src\/features\/segments\/segment-(?:builder|condition|filter-node|form)/.test(
      workspacePath,
    ) ||
    /^apps\/client\/src\/features\/website\/(?:custom-redirect|landing-page|resource-|signup-form|site-message)/.test(
      workspacePath,
    )
  );
}

function actualLineCount(source) {
  if (source.length === 0) return 0;
  const newlineCount = source.match(/\n/g)?.length ?? 0;
  return newlineCount + (source.endsWith("\n") ? 0 : 1);
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
