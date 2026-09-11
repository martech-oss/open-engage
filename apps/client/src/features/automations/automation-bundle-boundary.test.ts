import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const clientSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("automation route bundle boundary", () => {
  it("keeps the list and editor shells free from the lazy canvas dependency graph", async () => {
    const graph = await sourceGraph();
    const list = resolve(clientSourceRoot, "features/automations/automation-list-page.tsx");
    const editor = resolve(clientSourceRoot, "features/automations/automation-editor-page.tsx");
    const root = resolve(clientSourceRoot, "routes/__root.tsx");
    const canvas = resolve(clientSourceRoot, "features/automations/automation-flow-canvas.tsx");
    const automationAi = resolve(
      clientSourceRoot,
      "features/automations/automation-ai-sheet/index.tsx",
    );
    const emailSequenceAi = resolve(
      clientSourceRoot,
      "features/automations/email-sequence-ai-sheet/index.tsx",
    );

    expect(staticClosure(graph, list)).not.toContain(canvas);
    expect(staticClosure(graph, editor)).not.toContain(canvas);
    expect(graph.get(editor)?.dynamic).toContain(canvas);
    expect(graph.get(list)?.dynamic).toEqual(
      expect.arrayContaining([automationAi, emailSequenceAi]),
    );
    expect(staticClosure(graph, list)).not.toContain(automationAi);
    expect(staticClosure(graph, list)).not.toContain(emailSequenceAi);

    for (const entry of [list, editor, root]) {
      const dependencies = dependencySpecifiers(graph, staticClosure(graph, entry));
      expect(dependencies).not.toContain("@xyflow/react");
      expect(dependencies).not.toContain("@xyflow/react/dist/style.css");
    }
  });

  it("owns every XYFlow runtime and stylesheet import inside the lazy canvas closure", async () => {
    const graph = await sourceGraph();
    const canvas = resolve(clientSourceRoot, "features/automations/automation-flow-canvas.tsx");
    const canvasClosure = new Set(staticClosure(graph, canvas));
    const xyflowImporters = [...graph.entries()]
      .filter(([, node]) =>
        [...node.staticSpecifiers, ...node.dynamicSpecifiers].some((specifier) =>
          specifier.startsWith("@xyflow/react"),
        ),
      )
      .map(([file]) => file);

    expect(xyflowImporters.length).toBeGreaterThan(0);
    expect(xyflowImporters.every((file) => canvasClosure.has(file))).toBe(true);
    expect(dependencySpecifiers(graph, [...canvasClosure])).toEqual(
      expect.arrayContaining(["@xyflow/react", "@xyflow/react/dist/style.css"]),
    );
  });

  it("prevents every route shell from statically importing a canvas-owned module", async () => {
    const graph = await sourceGraph();
    const routeRoot = resolve(clientSourceRoot, "routes");
    const canvasOwned = [
      resolve(clientSourceRoot, "features/automations/automation-flow-canvas.tsx"),
      resolve(clientSourceRoot, "features/automations/automation-flow-node.tsx"),
      resolve(clientSourceRoot, "features/automations/use-automation-builder.ts"),
      ...[...graph.keys()].filter((file) =>
        file.includes("/features/automations/automation-node-settings/"),
      ),
    ];
    const routes = [...graph.keys()].filter(
      (file) => file.startsWith(`${routeRoot}/`) && /\.tsx?$/.test(file),
    );

    for (const route of routes) {
      const routeClosure = staticClosure(graph, route);
      for (const ownedModule of canvasOwned) expect(routeClosure).not.toContain(ownedModule);
    }
  });

  it("does not expose heavy optional UI through the shared app-ui barrel", async () => {
    const graph = await sourceGraph();
    const barrel = resolve(clientSourceRoot, "components/app-ui/index.tsx");
    const dependencies = dependencySpecifiers(graph, staticClosure(graph, barrel));

    expect(dependencies).not.toContain("recharts");
    expect(staticClosure(graph, barrel)).not.toContain(
      resolve(clientSourceRoot, "components/app-ui/dialogs.tsx"),
    );
  });

  it("keeps Recharts out of every route except Dashboard and Reports", async () => {
    const graph = await sourceGraph();
    const routeRoot = resolve(clientSourceRoot, "routes");
    const routes = [...graph.keys()].filter(
      (file) => file.startsWith(`${routeRoot}/`) && /\.tsx?$/.test(file),
    );

    const allowedChartRoutes = new Set([
      "_app.dashboard.tsx",
      "_app.deal-reports.tsx",
      "_app.reports.tsx",
    ]);
    for (const route of routes) {
      const routePath = relative(routeRoot, route);
      if (allowedChartRoutes.has(routePath)) continue;
      expect(dependencySpecifiers(graph, staticClosure(graph, route))).not.toContain("recharts");
    }
  });
});

interface GraphNode {
  dynamic: string[];
  dynamicSpecifiers: string[];
  static: string[];
  staticSpecifiers: string[];
}

async function sourceGraph(): Promise<Map<string, GraphNode>> {
  const files = await collectSourceFiles(clientSourceRoot);
  const fileSet = new Set(files);
  const graph = new Map<string, GraphNode>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const dynamicSpecifiers = [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(
      (match) => match[1]!,
    );
    const withoutDynamic = source.replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, "");
    const staticSpecifiers = [
      ...withoutDynamic.matchAll(
        /(?:\bimport\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?|\bexport\s+(?:type\s+)?[^"']*?\s+from\s+)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]!);
    graph.set(file, {
      dynamic: dynamicSpecifiers.flatMap((specifier) => resolveInternal(file, specifier, fileSet)),
      dynamicSpecifiers,
      static: staticSpecifiers.flatMap((specifier) => resolveInternal(file, specifier, fileSet)),
      staticSpecifiers,
    });
  }
  return graph;
}

function staticClosure(graph: Map<string, GraphNode>, entry: string): string[] {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    pending.push(...(graph.get(file)?.static ?? []));
  }
  return [...visited];
}

function dependencySpecifiers(graph: Map<string, GraphNode>, files: string[]): string[] {
  return [...new Set(files.flatMap((file) => graph.get(file)?.staticSpecifiers ?? []))].sort();
}

function resolveInternal(file: string, specifier: string, files: Set<string>): string[] {
  const base = specifier.startsWith("@/")
    ? resolve(clientSourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(file), specifier)
      : null;
  if (!base) return [];
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  const target = candidates.find((candidate) => files.has(candidate));
  return target ? [target] : [];
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}
