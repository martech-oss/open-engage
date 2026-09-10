// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataTableColumn } from "@/components/data-table";

import type { GradingCriterionRow, ScoringCategoryRow } from "./scoring-api";
import { CategoryCardView } from "./scoring-category-card";
import { GradingCriterionEditorShell, ScoringRuleEditorShell } from "./scoring-editor-shells";
import { useScoringGradingController } from "./scoring-grading-controller";
import { useScoringRulesController } from "./scoring-rules-controller";

const doubles = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() });
  return {
    createRule: mutation(),
    updateRule: mutation(),
    createCriterion: mutation(),
    updateCriterion: mutation(),
    passive: mutation(),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() },
}));
vi.mock("@/features/contacts/contact-api", () => ({
  contactOptionsQueryOptions: () => ({ queryKey: ["contacts", "options"], queryFn: () => null }),
}));
vi.mock("./scoring-api", () => ({
  scoringRulesQueryOptions: () => ({
    queryKey: ["scoring", "rules"],
    queryFn: () => ({ items: [], total: 0, summary: { enabled: 0, pageActions: 0 } }),
  }),
  scoringCategoriesQueryOptions: () => ({ queryKey: ["scoring", "categories"], queryFn: () => [] }),
  gradingCriteriaQueryOptions: () => ({
    queryKey: ["scoring", "criteria"],
    queryFn: () => ({ items: [], total: 0, summary: { enabled: 0, totalSteps: 0 } }),
  }),
  useCreateScoringRule: () => doubles.createRule,
  useUpdateScoringRule: () => doubles.updateRule,
  useCreateGradingCriterion: () => doubles.createCriterion,
  useUpdateGradingCriterion: () => doubles.updateCriterion,
  useCreateScoringCategory: () => doubles.passive,
  useArchiveScoringRule: () => doubles.passive,
  useArchiveGradingCriterion: () => doubles.passive,
  useArchiveScoringCategory: () => doubles.passive,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("scoring editor composition sessions", () => {
  it("submits optional decay and cap values and clears them with blank fields", async () => {
    doubles.createRule.mutateAsync.mockRejectedValue(new Error("inspect draft"));
    render(<RuleSessionHarness />, { wrapper: queryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "ルールを開く" }));
    fireEvent.change(screen.getByLabelText("減衰日数"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("コンタクトごとの加点上限"), {
      target: { value: "100" },
    });
    fireEvent.submit(requiredForm());
    await screen.findByText("inspect draft");
    expect(doubles.createRule.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ decayDays: 30, maxScore: 100 }),
    );
    fireEvent.change(screen.getByLabelText("減衰日数"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("コンタクトごとの加点上限"), { target: { value: "" } });
    fireEvent.submit(requiredForm());
    await screen.findByText("inspect draft");
    expect(doubles.createRule.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ decayDays: null, maxScore: null }),
    );
  });
  it("drops a failed rule draft and conditional field when create is reopened", async () => {
    doubles.createRule.mutateAsync.mockRejectedValue(new Error("rule rejected"));
    render(<RuleSessionHarness />, { wrapper: queryWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "ルールを開く" }));
    fireEvent.change(screen.getByLabelText("一致条件"), { target: { value: "resource" } });
    expect(screen.getByLabelText("対象ID")).toBeTruthy();
    fireEvent.submit(requiredForm());
    await screen.findByText("rule rejected");

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "ルールを開く" }));

    expect(screen.queryByLabelText("対象ID")).toBeNull();
    expect(screen.queryByText("rule rejected")).toBeNull();
    expect(screen.getByLabelText("一致条件")).toHaveProperty("value", "any");
  });

  it("restores the same grading item's initial field and clears its prior error", async () => {
    doubles.updateCriterion.mutateAsync.mockRejectedValue(new Error("criterion rejected"));
    render(<GradingSessionHarness item={criterion()} />, {
      wrapper: queryWrapper(),
    });

    fireEvent.click(screen.getByRole("button", { name: "条件を開く" }));
    fireEvent.change(screen.getByLabelText("対象フィールド"), {
      target: { value: "custom_field" },
    });
    expect(screen.getByLabelText("カスタムフィールドのキー")).toBeTruthy();
    fireEvent.submit(requiredForm());
    await screen.findByText("criterion rejected");

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "条件を開く" }));

    expect(screen.queryByLabelText("カスタムフィールドのキー")).toBeNull();
    expect(screen.queryByText("criterion rejected")).toBeNull();
    expect(screen.getByLabelText("対象フィールド")).toHaveProperty("value", "stage");
  });
});

describe("prop-only scoring views", () => {
  it("renders category rows through provided columns and delegates opening", () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const category: ScoringCategoryRow = {
      id: "category-1",
      name: "Product A",
      slug: "product-a",
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };
    const columns: DataTableColumn<ScoringCategoryRow>[] = [
      { key: "name", header: "受け取った列", cell: (item) => item.name },
    ];

    render(
      <CategoryCardView
        categories={[category]}
        columns={columns}
        open={false}
        onOpenChange={onOpenChange}
        onSubmit={() => undefined}
        busy={false}
        error=""
      />,
    );

    expect(screen.getByText("受け取った列")).toBeTruthy();
    expect(screen.getByText("Product A")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "カテゴリを追加" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

function RuleSessionHarness(): ReactNode {
  const controller = useScoringRulesController();
  return (
    <>
      <button onClick={controller.editor.openCreate}>ルールを開く</button>
      <ScoringRuleEditorShell
        key={controller.editor.sessionId}
        item={controller.editor.editing}
        open={controller.editor.dialogOpen}
        onOpenChange={controller.editor.onOpenChange}
        onSaved={controller.editor.close}
      />
    </>
  );
}

function GradingSessionHarness({ item }: { item: GradingCriterionRow }): ReactNode {
  const controller = useScoringGradingController();
  return (
    <>
      <button onClick={() => controller.criterionEditor.openEdit(item)}>条件を開く</button>
      <GradingCriterionEditorShell
        key={controller.criterionEditor.sessionId}
        item={controller.criterionEditor.editing}
        open={controller.criterionEditor.dialogOpen}
        onOpenChange={controller.criterionEditor.onOpenChange}
        onSaved={controller.criterionEditor.close}
      />
    </>
  );
}

function queryWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["scoring", "rules"], {
    items: [],
    total: 0,
    summary: { enabled: 0, pageActions: 0 },
  });
  queryClient.setQueryData(["scoring", "categories"], []);
  queryClient.setQueryData(["scoring", "criteria"], {
    items: [],
    total: 0,
    summary: { enabled: 0, totalSteps: 0 },
  });
  queryClient.setQueryData(["contacts", "options"], {
    tags: [],
    segments: [],
    companies: [],
    stages: [],
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function criterion(): GradingCriterionRow {
  return {
    id: "criterion-1",
    name: "Qualified stage",
    field: "stage",
    fieldKey: null,
    operator: "eq",
    value: "qualified",
    steps: 3,
    enabled: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}

function requiredForm(): HTMLFormElement {
  const form = document.querySelector("form");
  if (!form) throw new Error("expected scoring editor form");
  return form;
}
