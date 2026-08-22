// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GradingCriterionRow, ScoringRuleRow } from "./scoring-api";
import {
  useGradingCriterionEditorController,
  useScoringGradingController,
  useScoringRuleEditorController,
  useScoringRulesController,
} from "./scoring-controllers";

const doubles = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() });
  return {
    archiveRule: mutation(),
    createRule: mutation(),
    updateRule: mutation(),
    archiveCriterion: mutation(),
    createCriterion: mutation(),
    updateCriterion: mutation(),
    archiveCategory: mutation(),
    createCategory: mutation(),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}));
vi.mock("@/features/contacts/contact-api", () => ({
  contactOptionsQueryOptions: () => ({ queryKey: ["contacts", "options"], queryFn: () => null }),
}));
vi.mock("./scoring-api", () => ({
  scoringRulesQueryOptions: () => ({ queryKey: ["scoring", "rules"], queryFn: () => [] }),
  scoringCategoriesQueryOptions: () => ({
    queryKey: ["scoring", "categories"],
    queryFn: () => [],
  }),
  gradingCriteriaQueryOptions: () => ({
    queryKey: ["scoring", "criteria"],
    queryFn: () => [],
  }),
  useArchiveScoringRule: () => doubles.archiveRule,
  useCreateScoringRule: () => doubles.createRule,
  useUpdateScoringRule: () => doubles.updateRule,
  useArchiveGradingCriterion: () => doubles.archiveCriterion,
  useCreateGradingCriterion: () => doubles.createCriterion,
  useUpdateGradingCriterion: () => doubles.updateCriterion,
  useArchiveScoringCategory: () => doubles.archiveCategory,
  useCreateScoringCategory: () => doubles.createCategory,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scoring page controllers", () => {
  it("reports rule archive success without an error toast", async () => {
    doubles.archiveRule.mutateAsync.mockResolvedValue({});
    const { result } = renderHook(() => useScoringRulesController(), { wrapper: queryWrapper() });

    await act(() => result.current.archive(rule({ id: "rule-1" })));

    expect(doubles.archiveRule.mutateAsync).toHaveBeenCalledWith({ id: "rule-1" });
    expect(toast.success).toHaveBeenCalledWith("ルールをアーカイブしました");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports grading archive failures without a success toast", async () => {
    doubles.archiveCriterion.mutateAsync.mockRejectedValue(new Error("archive unavailable"));
    const { result } = renderHook(() => useScoringGradingController(), {
      wrapper: queryWrapper(),
    });

    await act(() => result.current.archiveCriterion(criterion({ id: "criterion-1" })));

    expect(doubles.archiveCriterion.mutateAsync).toHaveBeenCalledWith({ id: "criterion-1" });
    expect(toast.error).toHaveBeenCalledWith("archive unavailable");
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("scoring editor controllers", () => {
  it("closes a new rule editor only after a successful create", async () => {
    doubles.createRule.mutateAsync.mockResolvedValue({});
    const onSaved = vi.fn<() => void>();
    const { result } = renderHook(() => useScoringRuleEditorController(null, onSaved), {
      wrapper: queryWrapper(),
    });

    await act(() => result.current.save(ruleValues));

    expect(doubles.createRule.mutateAsync).toHaveBeenCalledWith(ruleValues);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("");
  });

  it("keeps a rule editor open and exposes the create error", async () => {
    doubles.createRule.mutateAsync.mockRejectedValue(new Error("rule rejected"));
    const onSaved = vi.fn<() => void>();
    const { result } = renderHook(() => useScoringRuleEditorController(null, onSaved), {
      wrapper: queryWrapper(),
    });

    await act(() => result.current.save(ruleValues));

    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.error).toBe("rule rejected");
  });

  it("updates the selected grading criterion and closes on success", async () => {
    doubles.updateCriterion.mutateAsync.mockResolvedValue({});
    const onSaved = vi.fn<() => void>();
    const item = criterion({ id: "criterion-1", field: "stage" });
    const { result } = renderHook(() => useGradingCriterionEditorController(item, onSaved), {
      wrapper: queryWrapper(),
    });

    await act(() => result.current.save(criterionValues));

    expect(doubles.updateCriterion.mutateAsync).toHaveBeenCalledWith({
      id: "criterion-1",
      ...criterionValues,
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });
});

const ruleValues = {
  name: "Pricing visit",
  eventType: "page_viewed",
  matchType: "url_contains",
  matchValue: "/pricing",
  points: 5,
  categoryId: null,
  tagId: null,
  enabled: true,
} as const;

const criterionValues = {
  name: "Qualified",
  field: "stage",
  fieldKey: null,
  operator: "eq",
  value: "qualified",
  steps: 3,
  enabled: true,
} as const;

function queryWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["scoring", "rules"], []);
  queryClient.setQueryData(["scoring", "categories"], []);
  queryClient.setQueryData(["scoring", "criteria"], []);
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

function rule(overrides: Partial<ScoringRuleRow> = {}): ScoringRuleRow {
  return {
    id: "rule-1",
    name: "Rule",
    eventType: "custom_event" as const,
    matchType: "any" as const,
    matchValue: null,
    points: 5,
    categoryId: null,
    categoryName: null,
    tagId: null,
    tagName: null,
    enabled: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

function criterion(overrides: Partial<GradingCriterionRow> = {}): GradingCriterionRow {
  return {
    id: "criterion-1",
    name: "Criterion",
    field: "stage" as const,
    fieldKey: null,
    operator: "eq" as const,
    value: "qualified",
    steps: 1,
    enabled: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}
