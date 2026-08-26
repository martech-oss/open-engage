import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const canvasEntry = "src/features/automations/automation-flow-canvas.tsx";
const editorRoute = "src/routes/_app.automations.$id.tsx?tsr-split=component";
const listRoute = "src/routes/_app.automations.index.tsx?tsr-split=component";
const contactsRoute = "src/routes/_app.contacts.index.tsx?tsr-split=component";
const dashboardRoute = "src/routes/_app.dashboard.tsx?tsr-split=component";
const chartRouteAllowlist = new Set([
  "src/routes/_app.dashboard.tsx?tsr-split=component",
  "src/routes/_app.deal-reports.tsx?tsr-split=component",
  "src/routes/_app.reports.tsx?tsr-split=component",
]);
const xyflowJavaScript = /(?:react-flow__|xy-flow__|ReactFlow|@xyflow\/react)/i;
const xyflowCss = /(?:\.react-flow(?:__|\b)|xyflow)/i;
const rechartsJavaScript = /(?:ResponsiveContainer|Recharts|recharts)/i;
const rootForbiddenChunk = /vendor-zod/i;
const rootForbiddenContractOwner =
  /(?:@openengage\/orpc|packages\/orpc\/src\/(?:contract|index|app\/contract))/i;
const rootForbiddenContractSentinel = /(?:["'`]\/app\/bootstrap["'`]|APIキーが無効です)/;
const budgets = {
  rootJavaScript: 250 * 1024,
  rootCss: 55 * 1024,
  contactsJavaScript: 350 * 1024,
  dashboardJavaScript: 390 * 1024,
};

export async function verifyClientBundles({ root = resolve(import.meta.dirname, "..") } = {}) {
  const outputRoot = resolve(root, "apps/client/dist/client");
  const manifestPath = resolve(outputRoot, ".vite/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const contents = await readArtifactContents(outputRoot, manifest);
  const routeEntries = Object.keys(manifest).filter((key) =>
    /^src\/routes\/.*\?tsr-split=component$/.test(key),
  );
  const routerRegistryEntries = findTanstackRouterRegistryEntries(manifest, routeEntries);
  const rootEntry = findTanstackClientEntry(manifest);

  requireEntries(manifest, [
    canvasEntry,
    editorRoute,
    listRoute,
    contactsRoute,
    dashboardRoute,
    ...chartRouteAllowlist,
  ]);
  const rootClosure = closure(manifest, rootEntry, false);
  const bundleSizes = {
    rootJavaScript: gzipSizeForJavaScript(rootClosure, manifest, contents.files),
    rootCss: gzipSizeForCss(rootClosure, manifest, contents.css),
    contactsJavaScript: gzipSizeForJavaScript(
      routeClosure(manifest, contactsRoute, routerRegistryEntries),
      manifest,
      contents.files,
    ),
    dashboardJavaScript: gzipSizeForJavaScript(
      routeClosure(manifest, dashboardRoute, routerRegistryEntries),
      manifest,
      contents.files,
    ),
  };
  assertBudget("root JavaScript", bundleSizes.rootJavaScript, budgets.rootJavaScript);
  assertBudget("root CSS", bundleSizes.rootCss, budgets.rootCss);
  assertBudget("contacts JavaScript", bundleSizes.contactsJavaScript, budgets.contactsJavaScript);
  assertBudget(
    "dashboard JavaScript",
    bundleSizes.dashboardJavaScript,
    budgets.dashboardJavaScript,
  );
  for (const key of rootClosure) {
    const chunk = manifest[key];
    if (
      rootForbiddenChunk.test(`${key}\n${chunk.file}`) ||
      rootForbiddenContractOwner.test(`${key}\n${chunk.file}\n${chunk.src ?? ""}`) ||
      rootForbiddenContractSentinel.test(contents.files.get(key) ?? "")
    ) {
      throw new Error(`root client entry must not reach Zod or the runtime contract: ${key}`);
    }
  }
  const editorDynamics = new Set(manifest[editorRoute].dynamicImports ?? []);
  if (!editorDynamics.has(canvasEntry)) {
    throw new Error(`${editorRoute}: editor must directly lazy-load ${canvasEntry}`);
  }

  const canvasClosure = closure(manifest, canvasEntry, false);
  const xyflowEntries = new Set(
    Object.keys(manifest).filter((key) => xyflowJavaScript.test(contents.files.get(key) ?? "")),
  );
  const xyflowCssOwners = new Set(
    Object.keys(manifest).filter((key) =>
      (manifest[key].css ?? []).some((file) => xyflowCss.test(contents.css.get(file) ?? "")),
    ),
  );
  if (xyflowEntries.size === 0 || xyflowCssOwners.size === 0) {
    throw new Error("production output must contain detectable XYFlow JavaScript and CSS");
  }
  for (const key of [...xyflowEntries, ...xyflowCssOwners]) {
    if (!canvasClosure.has(key)) {
      throw new Error(`XYFlow CSS/JavaScript must be owned by the lazy canvas closure: ${key}`);
    }
  }

  for (const route of routeEntries) {
    const staticRouteClosure = closure(manifest, route, false);
    if (
      intersects(staticRouteClosure, xyflowEntries) ||
      intersects(staticRouteClosure, xyflowCssOwners)
    ) {
      throw new Error(`${route}: ordinary route shell statically reaches XYFlow JavaScript or CSS`);
    }
    const completeRouteClosure = routeClosure(manifest, route, routerRegistryEntries);
    if (
      route !== editorRoute &&
      (intersects(completeRouteClosure, xyflowEntries) ||
        intersects(completeRouteClosure, xyflowCssOwners))
    ) {
      throw new Error(`${route}: ordinary route dynamically reaches XYFlow JavaScript or CSS`);
    }
  }

  const rechartsEntries = new Set(
    Object.keys(manifest).filter((key) => rechartsJavaScript.test(contents.files.get(key) ?? "")),
  );
  if (rechartsEntries.size === 0) {
    throw new Error("production output must contain detectable Recharts JavaScript");
  }
  for (const route of routeEntries) {
    if (chartRouteAllowlist.has(route)) continue;
    if (intersects(routeClosure(manifest, route, routerRegistryEntries), rechartsEntries)) {
      throw new Error(`${route}: only exact Dashboard/Reports routes may reach Recharts`);
    }
  }

  return {
    bundleSizes,
    chartRoutes: [...chartRouteAllowlist],
    manifestPath,
    rechartsEntries: [...rechartsEntries],
    xyflowCssOwners: [...xyflowCssOwners],
    xyflowEntries: [...xyflowEntries],
  };
}

function findTanstackClientEntry(manifest) {
  const tanstackClientEntry =
    /(?:^|\/)node_modules\/@tanstack\/react-start\/dist\/plugin\/default-entry\/client\.[cm]?[jt]sx?$/;
  const match = Object.entries(manifest).find(([key, chunk]) => {
    const source = (chunk.src ?? key).replaceAll("\\", "/");
    return chunk.isEntry === true && tanstackClientEntry.test(source);
  });
  if (!match) throw new Error("production manifest is missing the TanStack root client entry");
  return match[0];
}

function gzipSizeForJavaScript(entries, manifest, files) {
  const seen = new Set();
  let size = 0;
  for (const key of entries) {
    const file = manifest[key].file;
    if (seen.has(file)) continue;
    seen.add(file);
    size += gzipSync(files.get(key) ?? "").byteLength;
  }
  return size;
}

function gzipSizeForCss(entries, manifest, css) {
  const seen = new Set();
  let size = 0;
  for (const key of entries) {
    for (const file of manifest[key].css ?? []) {
      if (seen.has(file)) continue;
      seen.add(file);
      size += gzipSync(css.get(file) ?? "").byteLength;
    }
  }
  return size;
}

function assertBudget(label, actual, maximum) {
  if (actual <= maximum) return;
  throw new Error(
    `${label} is ${formatKilobytes(actual)} gzip; budget is ${formatKilobytes(maximum)}`,
  );
}

function formatKilobytes(bytes) {
  return `${Math.ceil(bytes / 1024)} KB`;
}

function routeClosure(manifest, route, routerRegistryEntries) {
  const pending = [route];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    const chunk = manifest[current];
    if (!chunk) throw new Error(`production manifest has a dangling chunk reference: ${current}`);
    visited.add(current);
    pending.push(...(chunk.imports ?? []));
    if (!routerRegistryEntries.has(current)) pending.push(...(chunk.dynamicImports ?? []));
  }
  return visited;
}

function findTanstackRouterRegistryEntries(manifest, routeEntries) {
  const tanstackClientEntry =
    /(?:^|\/)node_modules\/@tanstack\/react-start\/dist\/plugin\/default-entry\/client\.[cm]?[jt]sx?$/;
  return new Set(
    Object.entries(manifest)
      .filter(([key, chunk]) => {
        const source = (chunk.src ?? key).replaceAll("\\", "/");
        const registeredEntries = new Set(chunk.dynamicImports ?? []);
        return (
          chunk.isEntry === true &&
          tanstackClientEntry.test(source) &&
          routeEntries.length > 0 &&
          routeEntries.every((route) => registeredEntries.has(route))
        );
      })
      .map(([key]) => key),
  );
}

function closure(manifest, entry, includeDynamic) {
  const pending = [entry];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    const chunk = manifest[current];
    if (!chunk) throw new Error(`production manifest has a dangling chunk reference: ${current}`);
    visited.add(current);
    pending.push(...(chunk.imports ?? []));
    if (includeDynamic) pending.push(...(chunk.dynamicImports ?? []));
  }
  return visited;
}

function intersects(left, right) {
  return [...left].some((value) => right.has(value));
}

function requireEntries(manifest, entries) {
  for (const entry of entries) {
    if (!manifest[entry])
      throw new Error(`production manifest is missing required entry: ${entry}`);
  }
}

async function readArtifactContents(outputRoot, manifest) {
  const files = new Map();
  const css = new Map();
  await Promise.all(
    Object.entries(manifest).map(async ([key, chunk]) => {
      files.set(key, await readFile(resolve(outputRoot, chunk.file), "utf8"));
      await Promise.all(
        (chunk.css ?? []).map(async (file) => {
          if (!css.has(file)) css.set(file, await readFile(resolve(outputRoot, file), "utf8"));
        }),
      );
    }),
  );
  return { css, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await verifyClientBundles();
    process.stdout.write(
      `client bundles: ${result.xyflowEntries.length} XYFlow JS, ` +
        `${result.xyflowCssOwners.length} XYFlow CSS, ` +
        `${result.rechartsEntries.length} Recharts chunk owner(s); ` +
        `root JS ${result.bundleSizes.rootJavaScript} B gzip, ` +
        `root CSS ${result.bundleSizes.rootCss} B gzip, ` +
        `contacts JS ${result.bundleSizes.contactsJavaScript} B gzip, ` +
        `dashboard JS ${result.bundleSizes.dashboardJavaScript} B gzip; boundaries verified.\n`,
    );
  } catch (error) {
    process.stderr.write(`Client bundle boundary violation: ${error.message}\n`);
    process.exitCode = 1;
  }
}
