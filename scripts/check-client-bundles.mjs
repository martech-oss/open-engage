import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const canvasEntry = "src/features/automations/automation-flow-canvas.tsx";
const editorRoute = "src/routes/_app.automations.$id.tsx?tsr-split=component";
const listRoute = "src/routes/_app.automations.index.tsx?tsr-split=component";
const chartRouteAllowlist = new Set([
  "src/routes/_app.dashboard.tsx?tsr-split=component",
  "src/routes/_app.deal-reports.tsx?tsr-split=component",
  "src/routes/_app.reports.tsx?tsr-split=component",
]);
const xyflowJavaScript = /(?:react-flow__|xy-flow__|ReactFlow|@xyflow\/react)/i;
const xyflowCss = /(?:\.react-flow(?:__|\b)|xyflow)/i;
const rechartsJavaScript = /(?:ResponsiveContainer|Recharts|recharts)/i;

export async function verifyClientBundles({ root = resolve(import.meta.dirname, "..") } = {}) {
  const outputRoot = resolve(root, "apps/client/dist/client");
  const manifestPath = resolve(outputRoot, ".vite/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const contents = await readArtifactContents(outputRoot, manifest);
  const routeEntries = Object.keys(manifest).filter((key) =>
    /^src\/routes\/.*\?tsr-split=component$/.test(key),
  );

  requireEntries(manifest, [canvasEntry, editorRoute, listRoute, ...chartRouteAllowlist]);
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
    const completeRouteClosure = routeClosure(manifest, route);
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
    if (intersects(routeClosure(manifest, route), rechartsEntries)) {
      throw new Error(`${route}: only exact Dashboard/Reports routes may reach Recharts`);
    }
  }

  return {
    chartRoutes: [...chartRouteAllowlist],
    manifestPath,
    rechartsEntries: [...rechartsEntries],
    xyflowCssOwners: [...xyflowCssOwners],
    xyflowEntries: [...xyflowEntries],
  };
}

function routeClosure(manifest, route) {
  const visited = closure(manifest, route, false);
  const pending = [...(manifest[route].dynamicImports ?? [])];
  const expandedDynamicEntries = new Set();
  while (pending.length > 0) {
    const dynamicEntry = pending.pop();
    if (!dynamicEntry || expandedDynamicEntries.has(dynamicEntry)) continue;
    expandedDynamicEntries.add(dynamicEntry);
    for (const dependency of closure(manifest, dynamicEntry, false)) visited.add(dependency);
    pending.push(...(manifest[dynamicEntry]?.dynamicImports ?? []));
  }
  return visited;
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
        `${result.rechartsEntries.length} Recharts chunk owner(s); boundaries verified.\n`,
    );
  } catch (error) {
    process.stderr.write(`Client bundle boundary violation: ${error.message}\n`);
    process.exitCode = 1;
  }
}
