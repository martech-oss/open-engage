// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyLandingPageDocument, landingPageSchema } from "@openengage/core/web";

import { LandingPageEditorDialog } from "./landing-page-editor-dialog";

const { generate, publish, retry } = vi.hoisted(() => ({
  generate: vi.fn<() => Promise<object>>(async () => ({})),
  publish: vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  retry: vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
}));
vi.mock("./landing-optimization-panel", () => ({
  LandingOptimizationPanel: () => (
    <form aria-label="改善設定">
      <button>保存</button>
    </form>
  ),
}));
vi.mock("./website-api", () => ({
  landingPageDesignQueryOptions: () => ({
    queryKey: ["design"],
    queryFn: async () => ({
      name: "相談",
      slug: "consult",
      currentVersionId: "v2",
      publishedVersionId: "v1",
      previewHtml: "<h1>Preview</h1>",
      jobs: [
        {
          id: "invalid",
          prompt: "Invalid",
          explanation: null,
          error: "Invalid reference",
          status: "failed",
          retryable: false,
          baseVersionId: "v2",
        },
        {
          id: "stale",
          prompt: "Old",
          explanation: null,
          error: "Timeout",
          status: "failed",
          retryable: true,
          baseVersionId: "v1",
        },
        {
          id: "j1",
          prompt: "青色に変更",
          explanation: null,
          error: "生成に失敗しました",
          status: "failed",
          retryable: true,
          baseVersionId: "v2",
        },
      ],
      versions: [
        { id: "v2", version: 2, publishedAt: null, document: emptyLandingPageDocument() },
        { id: "v1", version: 1, publishedAt: "2026-01-01", document: emptyLandingPageDocument() },
      ],
    }),
  }),
  useGenerateLandingPage: () => ({ mutateAsync: generate }),
  usePublishLandingPage: () => ({ mutateAsync: publish }),
  useRetryLandingGeneration: () => ({ mutateAsync: retry }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("landing page editor", () => {
  it("offers isolated mobile preview, keyboard-accessible revision generation and rollback", async () => {
    const item = landingPageSchema.parse({
      id: "page",
      name: "相談",
      slug: "consult",
      status: "published",
      currentVersionId: "v2",
      publishedVersionId: "v1",
      version: 2,
      contentDocument: null,
      document: emptyLandingPageDocument(),
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const update = vi.fn<() => Promise<{ id: string; versionId: string }>>(async () => ({
      id: "page",
      versionId: "v3",
    }));
    render(
      <QueryClientProvider client={client}>
        <LandingPageEditorDialog
          item={item}
          open
          onOpenChange={() => undefined}
          onSaved={() => undefined}
          createMutation={{ mutateAsync: vi.fn<() => Promise<never>>() }}
          updateMutation={{ mutateAsync: update }}
        />
      </QueryClientProvider>,
    );
    const preview = await screen.findByTitle("ランディングページのプレビュー");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(screen.getByText("生成に失敗しました")).toBeTruthy();
    const retryButtons = screen.getAllByRole<HTMLButtonElement>("button", {
      name: "この生成を再試行",
    });
    expect(retryButtons).toHaveLength(2);
    expect(retryButtons.filter((button) => button.disabled)).toHaveLength(1);
    fireEvent.click(retryButtons.find((button) => !button.disabled)!);
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ pageId: "page", jobId: "j1" }));
    const mobile = screen.getByRole("button", { name: "スマートフォン" });
    mobile.focus();
    expect(document.activeElement).toBe(mobile);
    fireEvent.click(mobile);
    expect(preview.style.width).toBe("390px");
    expect(document.querySelector("form form")).toBeNull();
    fireEvent.change(screen.getByLabelText("修正したいこと"), {
      target: { value: "見出しを短く" },
    });
    fireEvent.submit(document.getElementById("landing-generation-form")!);
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          pageId: "page",
          baseVersionId: "v2",
          prompt: "見出しを短く",
          requestKey: expect.any(String),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "下書きを公開" }));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith({ id: "page", versionId: "v2", baseVersionId: "v2" }),
    );
    fireEvent.change(screen.getByLabelText("ページ名"), { target: { value: "新しい管理名" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を保存" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "page",
          name: "新しい管理名",
          slug: "consult",
          baseVersionId: "v2",
          document: expect.any(Object),
        }),
      ),
    );
  });
});
