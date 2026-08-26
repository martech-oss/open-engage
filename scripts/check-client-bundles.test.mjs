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
const contactsRoute = "src/routes/_app.contacts.index.tsx?tsr-split=component";
const canvas = "src/features/automations/automation-flow-canvas.tsx";
const rootEntry = "../../node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx";

async function fixture(t, mutator = () => {}) {
  const root = await mkdtemp(resolve(tmpdir(), "openengage-client-bundles-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const output = resolve(root, "apps/client/dist/client");
  const manifest = {
    [editorRoute]: entry("editor.js", { dynamicImports: [canvas] }),
    [listRoute]: entry("list.js"),
    [ordinaryRoute]: entry("contacts.js"),
    [contactsRoute]: entry("contacts-index.js"),
    [dashboardRoute]: entry("dashboard.js", { imports: ["_charts.js"] }),
    [reportsRoute]: entry("reports.js", { imports: ["_charts.js"] }),
    [dealReportsRoute]: entry("deal-reports.js", { imports: ["_charts.js"] }),
    [canvas]: entry("canvas.js", { css: ["assets/canvas.css"], isDynamicEntry: true }),
    "_charts.js": entry("charts.js"),
    [rootEntry]: entry("root.js", { isDynamicEntry: false, isEntry: true, src: rootEntry }),
  };
  const assets = {
    "editor.js": "export const editor = true;",
    "list.js": "export const list = true;",
    "contacts.js": "export const contacts = true;",
    "contacts-index.js": "export const contactsIndex = true;",
    "dashboard.js": "export const dashboard = true;",
    "reports.js": "export const reports = true;",
    "deal-reports.js": "export const dealReports = true;",
    "canvas.js": 'const className = "react-flow__node";',
    "charts.js": "const ResponsiveContainer = true;",
    "assets/canvas.css": ".react-flow { display: flex; }",
    "root.js": "export const root = true;",
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

void test("accepts the exact automation and chart production bundle boundaries", async (t) => {
  const root = await fixture(t);
  await assert.doesNotReject(() => verifyClientBundles({ root }));
});

void test("rejects an ordinary route that statically reaches the XYFlow canvas chunk and CSS", async (t) => {
  const root = await fixture(t, (manifest) => {
    manifest[ordinaryRoute].imports = [canvas];
  });

  await assert.rejects(() => verifyClientBundles({ root }), /ordinary route.*XYFlow/i);
});

void test("rejects global XYFlow CSS outside the lazy canvas closure", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[listRoute].css = ["assets/global.css"];
    assets["assets/global.css"] = ".react-flow__edge { stroke: black; }";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /XYFlow CSS.*canvas/i);
});

void test("uses exact chart route allowlists instead of route-name substrings", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    const previewRoute = "src/routes/_app.reports-preview.tsx?tsr-split=component";
    manifest[previewRoute] = entry("reports-preview.js", { imports: ["_charts.js"] });
    assets["reports-preview.js"] = "export const preview = true;";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /reports-preview.*Recharts/i);
});

void test("rejects XYFlow dynamically imported by a route's shared static dependency", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[ordinaryRoute].imports = ["_shared-feature.js"];
    manifest["_shared-feature.js"] = entry("shared-feature.js", {
      dynamicImports: [canvas],
    });
    assets["shared-feature.js"] = "export const loadCanvas = () => import('./canvas.js');";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /ordinary route.*XYFlow/i);
});

void test("rejects Recharts dynamically imported by a route's shared static dependency", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[ordinaryRoute].imports = ["_shared-feature.js"];
    manifest["_shared-feature.js"] = entry("shared-feature.js", {
      dynamicImports: ["_charts.js"],
    });
    assets["shared-feature.js"] = "export const loadChart = () => import('./charts.js');";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /contacts.*Recharts/i);
});

void test("does not attribute TanStack router registry dynamics to every route", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    const registry =
      "../../node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx";
    manifest[ordinaryRoute].imports = [registry];
    manifest[registry] = entry("router-registry.js", {
      dynamicImports: [
        editorRoute,
        listRoute,
        ordinaryRoute,
        contactsRoute,
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

void test("rejects root JavaScript above the 250 KB gzip budget", async (t) => {
  const root = await fixture(t, (_manifest, assets) => {
    assets["root.js"] = noisyText(420 * 1024);
  });

  await assert.rejects(() => verifyClientBundles({ root }), /root JavaScript.*250 KB/i);
});

void test("rejects root CSS above the 55 KB gzip budget", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[rootEntry].css = ["assets/root.css"];
    assets["assets/root.css"] = noisyText(100 * 1024);
  });

  await assert.rejects(() => verifyClientBundles({ root }), /root CSS.*55 KB/i);
});

void test("rejects contacts and dashboard closures over their gzip budgets", async (t) => {
  const contactsRoot = await fixture(t, (_manifest, assets) => {
    assets["contacts-index.js"] = noisyText(560 * 1024);
  });
  await assert.rejects(() => verifyClientBundles({ root: contactsRoot }), /contacts.*350 KB/i);

  const dashboardRoot = await fixture(t, (_manifest, assets) => {
    assets["dashboard.js"] = noisyText(630 * 1024);
  });
  await assert.rejects(() => verifyClientBundles({ root: dashboardRoot }), /dashboard.*390 KB/i);
});

void test("rejects a root closure that reaches the vendor-zod chunk", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[rootEntry].imports = ["_vendor-zod.js"];
    manifest["_vendor-zod.js"] = entry("vendor-zod.js");
    assets["vendor-zod.js"] = "export const schemaLibrary = true;";
  });

  await assert.rejects(() => verifyClientBundles({ root }), /root.*Zod/i);
});

void test("rejects a root closure that reaches only the runtime contract", async (t) => {
  const root = await fixture(t, (manifest, assets) => {
    manifest[rootEntry].imports = ["_shared-boundary.js"];
    manifest["_shared-boundary.js"] = entry("shared-boundary.js");
    assets["shared-boundary.js"] = 'export const bootstrapRoute = "/app/bootstrap";';
  });

  await assert.rejects(() => verifyClientBundles({ root }), /runtime contract/i);
});

function noisyText(length) {
  let state = 0x12345678;
  let output = "";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    output += String.fromCharCode(33 + (state % 90));
  }
  return output;
}
