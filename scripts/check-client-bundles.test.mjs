import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { verifyClientBundles } from "./check-client-bundles.mjs";

const editorRoute = "src/routes/_app.automations.$id.tsx?tsr-split=component";
const listRoute = "src/routes/_app.automations.index.tsx?tsr-split=component";
const dashboardRoute = "src/routes/_app.dashboard.tsx?tsr-split=component";
const reportsRoute = "src/routes/_app.reports.tsx?tsr-split=component";
const dealReportsRoute = "src/routes/_app.deal-reports.tsx?tsr-split=component";
const ordinaryRoute = "src/routes/_app.contacts.tsx?tsr-split=component";
const canvas = "src/features/automations/automation-flow-canvas.tsx";

async function fixture(t, mutator = () => {}) {
  const root = await mkdtemp(resolve(tmpdir(), "openengage-client-bundles-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const output = resolve(root, "apps/client/dist/client");
  const manifest = {
    [editorRoute]: entry("editor.js", { dynamicImports: [canvas] }),
    [listRoute]: entry("list.js"),
    [ordinaryRoute]: entry("contacts.js"),
    [dashboardRoute]: entry("dashboard.js", { imports: ["_charts.js"] }),
    [reportsRoute]: entry("reports.js", { imports: ["_charts.js"] }),
    [dealReportsRoute]: entry("deal-reports.js", { imports: ["_charts.js"] }),
    [canvas]: entry("canvas.js", { css: ["assets/canvas.css"], isDynamicEntry: true }),
    "_charts.js": entry("charts.js"),
  };
  const assets = {
    "editor.js": "export const editor = true;",
    "list.js": "export const list = true;",
    "contacts.js": "export const contacts = true;",
    "dashboard.js": "export const dashboard = true;",
    "reports.js": "export const reports = true;",
    "deal-reports.js": "export const dealReports = true;",
    "canvas.js": 'const className = "react-flow__node";',
    "charts.js": "const ResponsiveContainer = true;",
    "assets/canvas.css": ".react-flow { display: flex; }",
  };
  mutator(manifest, assets);
  await mkdir(resolve(output, ".vite"), { recursive: true });
  await writeFile(resolve(output, ".vite/manifest.json"), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(assets)) {
    const target = resolve(output, path.startsWith("assets/") ? path : `assets/${path}`);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

function entry(file, overrides = {}) {
  return { file: `assets/${file}`, isDynamicEntry: true, ...overrides };
}

test("accepts the exact automation and chart production bundle boundaries", async (t) => {
  const root = await fixture(t);
  await assert.doesNotReject(() => verifyClientBundles({ root }));
});

test("rejects an ordinary route that statically reaches the XYFlow canvas chunk and CSS", async (t) => {
  const root = await fixture(t, (manifest) => {
    manifest[ordinaryRoute].imports = [canvas];
  });

  await assert.rejects(() => verifyClientBundles({ root }), /ordinary route.*XYFlow/i);
});

test("rejects global XYFlow CSS outside the lazy canvas closure", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[listRoute].css = ["assets/global.css"];
    assets["assets/global.css"] = ".react-flow__edge { stroke: black; }";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /XYFlow CSS.*canvas/i);
});

test("uses exact chart route allowlists instead of route-name substrings", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    const previewRoute = "src/routes/_app.reports-preview.tsx?tsr-split=component";
    manifest[previewRoute] = entry("reports-preview.js", { imports: ["_charts.js"] });
    assets["reports-preview.js"] = "export const preview = true;";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /reports-preview.*Recharts/i);
});

test("rejects XYFlow dynamically imported by a route's shared static dependency", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[ordinaryRoute].imports = ["_shared-feature.js"];
    manifest["_shared-feature.js"] = entry("shared-feature.js", {
      dynamicImports: [canvas],
    });
    assets["shared-feature.js"] = "export const loadCanvas = () => import('./canvas.js');";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /ordinary route.*XYFlow/i);
});

test("rejects Recharts dynamically imported by a route's shared static dependency", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[ordinaryRoute].imports = ["_shared-feature.js"];
    manifest["_shared-feature.js"] = entry("shared-feature.js", {
      dynamicImports: ["_charts.js"],
    });
    assets["shared-feature.js"] = "export const loadChart = () => import('./charts.js');";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /contacts.*Recharts/i);
});

test("does not attribute TanStack router registry dynamics to every route", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    const registry =
      "../../node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx";
    manifest[ordinaryRoute].imports = [registry];
    manifest[registry] = entry("router-registry.js", {
      dynamicImports: [
        editorRoute,
        listRoute,
        ordinaryRoute,
        dashboardRoute,
        reportsRoute,
        dealReportsRoute,
      ],
      isDynamicEntry: false,
      isEntry: true,
      src: registry,
    });
    assets["router-registry.js"] = "export const registeredRoutes = true;";
  });

  await assert.doesNotReject(() => verifyClientBundles({ root }));
});
