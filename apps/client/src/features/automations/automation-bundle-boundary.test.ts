import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("automation route bundle boundary", () => {
  it("keeps the list route free from editor, ReactFlow, and eager AI sheet imports", async () => {
    const source = await readFile(new URL("./automation-list-page.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/from ["']@xyflow\/react["']/);
    expect(source).not.toMatch(/from ["']\.\/automation-(?:editor-page|flow-canvas)["']/);
    expect(source).not.toMatch(/import \{ AutomationAiSheet \}/);
    expect(source).not.toMatch(/import \{ EmailSequenceAiSheet \}/);
    expect(source).toContain('import("./automation-ai-sheet")');
    expect(source).toContain('import("./email-sequence-ai-sheet")');
  });

  it("loads ReactFlow through the editor-only dynamic canvas", async () => {
    const editor = await readFile(new URL("./automation-editor-page.tsx", import.meta.url), "utf8");
    const canvas = await readFile(new URL("./automation-flow-canvas.tsx", import.meta.url), "utf8");

    expect(editor).toContain('import("./automation-flow-canvas")');
    expect(canvas).toContain('from "@xyflow/react"');
  });
});
