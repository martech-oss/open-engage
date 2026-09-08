// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AutomationDefinition, AutomationDraft } from "@openengage/core/automations";

import { automationDraftQueryOptions } from "./automation-api";
import { AutomationBuilder } from "./automation-editor-page";

const rpc = vi.hoisted(() => ({
  getDraft: vi.fn<(input: { id: string }) => Promise<AutomationDraft>>(),
  saveDraft: vi.fn<(input: AutomationDefinition & { id: string }) => Promise<{ ok: true }>>(
    async () => ({ ok: true }),
  ),
  publish: vi.fn<
    (input: { id: string }) => Promise<{ publishedVersionId: string; draftVersionId: string }>
  >(async () => ({ publishedVersionId: "published", draftVersionId: "draft" })),
  setStatus: vi.fn<
    (input: { id: string; status: "active" | "paused" }) => Promise<{ status: "active" | "paused" }>
  >(async ({ status }) => ({ status })),
}));

vi.mock("@/lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  return {
    orpcQuery: createTanstackQueryUtils({
      automations: {
        ...rpc,
        list: async () => [],
        listRuns: async () => [],
        listEnrollments: async () => [],
        executionOptions: async () => ({
          projects: [],
          callableAutomations: [],
          scoringCategories: [],
        }),
        previewRun: async () => ({ versionId: "published", count: 0, sample: [] }),
        startRun: async () => ({ id: "run" }),
      },
    }),
  };
});

vi.mock("./automation-flow-canvas", () => ({
  default: ({
    onDefinitionChange,
  }: {
    onDefinitionChange: (graph: AutomationDefinition) => void;
  }) => (
    <button onClick={() => onDefinitionChange(definition("contact_created"))}>
      Change draft to event
    </button>
  ),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function definition(source: "batch" | "contact_created"): AutomationDefinition {
  return {
    name: "Run capability",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config:
          source === "batch"
            ? {
                source: "batch",
                reentry: "once",
                audience: {
                  kind: "filter",
                  filter: { kind: "condition", field: "score", operator: "gte", value: 0 },
                },
                schedule: { kind: "now" },
              }
            : { source: "contact_created", reentry: "once" },
      },
    ],
    edges: [],
  };
}

function draft(
  source: "batch" | "contact_created",
  publishedTriggerSource: string | null,
  status: AutomationDraft["status"] = "active",
): AutomationDraft {
  return {
    graph: definition(source),
    publishedTriggerSource,
    status,
    publishability: { publishable: true, capabilityState: null, issues: [], templates: [] },
  };
}

function renderEditor(initialDraft: AutomationDraft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  rpc.getDraft.mockResolvedValue(initialDraft);
  function Editor() {
    const { data } = useQuery({
      ...automationDraftQueryOptions("automation"),
      initialData: initialDraft,
    });
    return (
      <AutomationBuilder
        id="automation"
        initialDraft={data}
        options={{ templates: [], forms: [], segments: [] }}
      />
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Editor />
    </QueryClientProvider>,
  );
}

function showRuns() {
  fireEvent.click(screen.getByRole("button", { name: "実行履歴" }));
}

function canStart() {
  return screen.queryByRole("button", { name: "対象者を確認して実行" }) !== null;
}

describe("published automation run capability", () => {
  it.each([
    { source: "contact_created", published: "batch", status: "active", expected: true },
    { source: "batch", published: "contact_created", status: "active", expected: false },
    { source: "batch", published: null, status: "active", expected: false },
    { source: "batch", published: null, status: "draft", expected: false },
    { source: "contact_created", published: "batch", status: "paused", expected: false },
    { source: "batch", published: "batch", status: "archived", expected: false },
  ] as const)(
    "uses published $published with draft $source and status $status",
    ({ source, published, status, expected }) => {
      renderEditor(draft(source, published, status));
      showRuns();
      expect(canStart()).toBe(expected);
    },
  );

  it("keeps a live batch runnable after unsaved edits and saving an event draft", async () => {
    renderEditor(draft("batch", "batch"));
    fireEvent.click(await screen.findByRole("button", { name: "Change draft to event" }));
    showRuns();
    expect(canStart()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("下書きを保存しました");
    expect(canStart()).toBe(true);
  });

  it.each([
    { source: "contact_created", published: "batch", expected: false },
    { source: "batch", published: "contact_created", expected: true },
    { source: "batch", published: null, expected: true },
  ] as const)(
    "refreshes capability after publishing $source over $published",
    async ({ source, published, expected }) => {
      renderEditor(draft(source, published, published === null ? "draft" : "active"));
      rpc.getDraft.mockResolvedValue(draft(source, source));
      showRuns();
      fireEvent.click(screen.getByRole("button", { name: "公開" }));
      await screen.findByText("公開しました。設定した開始方法で登録されます。");
      await waitFor(() => expect(canStart()).toBe(expected));
    },
  );

  it("keeps the published capability when publishing fails", async () => {
    renderEditor(draft("batch", "contact_created"));
    rpc.publish.mockRejectedValueOnce(new Error("Publication failed"));
    showRuns();
    fireEvent.click(screen.getByRole("button", { name: "公開" }));
    await screen.findByText("Publication failed");
    expect(canStart()).toBe(false);
  });

  it("uses published batch capability when pausing and resuming an event draft", async () => {
    renderEditor(draft("contact_created", "batch"));
    showRuns();
    fireEvent.click(screen.getByRole("button", { name: "一時停止" }));
    await screen.findByRole("button", { name: "再開" });
    expect(canStart()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "再開" }));
    await waitFor(() => expect(canStart()).toBe(true));
  });
});
