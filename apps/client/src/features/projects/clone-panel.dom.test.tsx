// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WorkspaceTimeProvider } from "@/lib/workspace-time";
import type {
  VariableDefinition,
  ProjectCloneJob,
  ProjectCloneOptions,
  ProjectCloneResource,
  ProjectCloneSummary,
  ProjectCloneCursor,
  ProjectClonePage,
} from "@openengage/core/projects";

import type * as CloneApi from "./clone-api";
import { ProjectClonePanel } from "./clone-panel";

const { state } = vi.hoisted(() => ({
  state: {
    value: "",
    extraVariables: [] as VariableDefinition[],
    saved: [] as ProjectCloneOptions[],
    resources: [] as ProjectCloneResource[],
    summary: null as ProjectCloneSummary | null,
    progressReads: 0,
    listReads: [] as Array<{ id: string; cursor: ProjectCloneCursor | undefined }>,
    start:
      vi.fn<
        (input: { id: string; jobId: string; requestKey: string }) => Promise<ProjectCloneJob>
      >(),
    retry: vi.fn<(input: { id: string; jobId: string }) => void>(),
    retryError: null as Error | null,
    retryPending: false,
    firstPage: { items: [], nextCursor: null } as ProjectClonePage,
    secondPage: { items: [], nextCursor: null } as ProjectClonePage,
  },
}));
vi.mock("./clone-api", async (importOriginal) => {
  const api = await importOriginal<typeof CloneApi>();
  return {
    projectCloneListQueryOptions: (id: string, cursor?: ProjectCloneCursor) => ({
      ...api.projectCloneListQueryOptions(id, cursor),
      queryFn: async () => {
        state.listReads.push({ id, cursor });
        return cursor ? state.secondPage : state.firstPage;
      },
    }),
    projectCloneProgressQueryOptions: (id: string, jobId: string) => ({
      ...api.projectCloneProgressQueryOptions(id, jobId),
      queryFn: async () => {
        state.progressReads++;
        return state.summary;
      },
    }),
    usePreviewProjectClone: () => ({
      mutateAsync: async ({ options }: { options: ProjectCloneOptions }) => {
        state.saved.push(options);
        return {
          ...summary("job", options.name),
          workspaceId: "ws",
          createdByUserId: "user",
          requestKey: "preview-key",
          status: "preview",
          options,
          resources: state.resources,
          sharedReferences: [],
        };
      },
    }),
    useStartProjectClone: () => ({ mutateAsync: state.start }),
    useRetryProjectClone: () => ({
      mutate: state.retry,
      error: state.retryError,
      isPending: state.retryPending,
    }),
  };
});
vi.mock("./project-brief-api", () => ({
  projectBriefOptionsQueryOptions: () => ({
    queryKey: ["options"],
    queryFn: async () => ({ members: [] }),
  }),
}));
vi.mock("./variable-api", () => ({
  variablesQueryOptions: () => ({
    queryKey: ["variables"],
    queryFn: async () => ({
      effective: {
        values: [
          {
            id: "v",
            workspaceId: "ws",
            projectId: null,
            key: "starts_at",
            type: "datetime",
            value: state.value,
            revision: 1,
            updatedAt: "",
          },
          ...state.extraVariables,
        ],
      },
    }),
  }),
}));
beforeEach(() => {
  state.start.mockReset();
  state.retry.mockReset();
  state.retryError = null;
  state.retryPending = false;
  state.listReads = [];
  state.extraVariables = [];
});
afterEach(() => {
  cleanup();
  state.saved = [];
  state.resources = [];
  state.summary = null;
  state.progressReads = 0;
  state.firstPage = { items: [], nextCursor: null };
  state.secondPage = { items: [], nextCursor: null };
});
function mount(timeZone: string, canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function panel(projectId: string) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceTimeProvider value={{ timeZone, renderedAt: "2026-09-08T00:00:00Z" }}>
          <ProjectClonePanel projectId={projectId} projectName="Event" canEdit={canEdit} />
        </WorkspaceTimeProvider>
      </QueryClientProvider>
    );
  }
  const view = render(panel("p"));
  return { ...view, client, switchProject: (projectId: string) => view.rerender(panel(projectId)) };
}
it.each([
  ["Asia/Tokyo", "2026-09-08T03:04:56.789Z"],
  ["America/New_York", "2026-11-01T06:30:00.000Z"],
])(
  "preserves an untouched datetime exactly in %s, without adding an inherited override",
  async (zone, value) => {
    state.value = value;
    mount(zone);
    fireEvent.click(screen.getByRole("button", { name: "複製" }));
    await screen.findByLabelText("starts_at（datetime）");
    fireEvent.click(screen.getByRole("button", { name: "コピー対象を確認" }));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    expect(state.saved[0]?.variables).toEqual({});
    expect(screen.getByRole("button", { name: "この内容で複製" })).toBeTruthy();
  },
);
it("converts an explicitly changed datetime using the workspace time zone", async () => {
  state.value = "2026-09-08T03:04:56.789Z";
  mount("Asia/Tokyo");
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  fireEvent.change(await screen.findByLabelText("starts_at（datetime）"), {
    target: { value: "2026-09-09T12:45" },
  });
  fireEvent.click(screen.getByRole("button", { name: "コピー対象を確認" }));
  await waitFor(() => expect(state.saved).toHaveLength(1));
  expect(state.saved[0]?.variables).toEqual({ starts_at: "2026-09-09T03:45:00.000Z" });
});

function summary(id: string, name: string): ProjectCloneSummary {
  return {
    id,
    name,
    status: "failed",
    sourceProjectId: "p",
    targetProjectId: "target",
    preparedCount: 1,
    totalCount: 2,
    error: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    completedAt: null,
  };
}
it("retains the frozen resource preview while fetching only progress summaries", async () => {
  state.value = "2026-09-08T03:04:56.789Z";
  state.resources = [
    {
      kind: "form",
      name: "Frozen registration form",
      sourceId: "form",
      targetId: "copy",
      sourceVersion: "1",
      sourceSlug: "form",
      targetSlug: "form-copy",
      linked: true,
    },
  ];
  state.summary = { ...summary("job", "Event（コピー）"), status: "preview" };
  mount("Asia/Tokyo");
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  await screen.findByLabelText("starts_at（datetime）");
  fireEvent.click(screen.getByRole("button", { name: "コピー対象を確認" }));
  await waitFor(() => expect(state.progressReads).toBeGreaterThan(0));
  expect(screen.getByText("Frozen registration form")).toBeTruthy();
  expect(screen.getByText("form-copy")).toBeTruthy();
  expect(screen.getByRole("button", { name: "この内容で複製" })).toBeTruthy();
});
it("navigates next and previous history pages using server cursors", async () => {
  state.firstPage = {
    items: [summary("first", "First clone")],
    nextCursor: { createdAt: "2026-01-01", id: "first" },
  };
  state.secondPage = { items: [summary("older", "Older clone")], nextCursor: null };
  mount("Asia/Tokyo");
  await screen.findByText("First clone");
  expect((screen.getByRole("button", { name: "前へ" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "次へ" }));
  await screen.findByText("Older clone");
  expect((screen.getByRole("button", { name: "次へ" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "前へ" }));
  await screen.findByText("First clone");
});

it("starts a different project's history on its first page and retains both cursor fields", async () => {
  const cursor = { createdAt: "2026-01-01T12:34:56.789Z", id: "first" };
  state.firstPage = { items: [summary("first", "First clone")], nextCursor: cursor };
  state.secondPage = { items: [summary("older", "Older clone")], nextCursor: null };
  const view = mount("Asia/Tokyo");
  await screen.findByText("First clone");
  fireEvent.click(screen.getByRole("button", { name: "次へ" }));
  await screen.findByText("Older clone");
  expect(state.listReads.at(-1)).toEqual({ id: "p", cursor });
  state.firstPage = { items: [summary("new-first", "Other project clone")], nextCursor: null };
  view.switchProject("other");
  await screen.findByText("Other project clone");
  expect(state.listReads.at(-1)).toEqual({ id: "other", cursor: undefined });
  expect((screen.getByRole("button", { name: "前へ" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("Older clone")).toBeNull();
});

it("shows running progress and retries a failed job using its source project and job id", async () => {
  state.firstPage = {
    items: [{ ...summary("job-1", "Running clone"), status: "running" }],
    nextCursor: null,
  };
  const view = mount("Asia/Tokyo");
  const progress = await screen.findByRole("progressbar", { name: "複製の進捗" });
  expect(progress.getAttribute("max")).toBe("2");
  expect(progress.getAttribute("value")).toBe("1");
  expect(screen.queryByRole("button", { name: "失敗した複製を再試行" })).toBeNull();
  state.firstPage = {
    items: [
      { ...summary("job-1", "Failed clone"), sourceProjectId: "job-source", error: "Clone failed" },
    ],
    nextCursor: null,
  };
  await act(async () => {
    await view.client.invalidateQueries();
  });
  await screen.findByText("Clone failed");
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "失敗した複製を再試行" }));
  expect(state.retry).toHaveBeenCalledWith({ id: "job-source", jobId: "job-1" });
  state.retryError = new Error("Retry failed");
  view.switchProject("p");
  expect(screen.getByText("Retry failed")).toBeTruthy();
  state.retryPending = true;
  view.switchProject("p");
  expect((screen.getByRole("button", { name: /処理中…/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("hides clone and retry actions for a read-only project", async () => {
  state.firstPage = { items: [summary("job", "Failed clone")], nextCursor: null };
  mount("Asia/Tokyo", false);
  await screen.findByText("Failed clone");
  expect(screen.queryByRole("button", { name: "複製" })).toBeNull();
  expect(screen.queryByRole("button", { name: "失敗した複製を再試行" })).toBeNull();
});

it("keeps the preview on start failure, reuses its request key, and displays polled progress", async () => {
  state.value = "2026-09-08T03:04:56.789Z";
  const view = mount("Asia/Tokyo");
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  await screen.findByLabelText("starts_at（datetime）");
  expect(state.progressReads).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "コピー対象を確認" }));
  await screen.findByRole("button", { name: "この内容で複製" });
  state.start.mockRejectedValueOnce(new Error("Start failed"));
  fireEvent.click(screen.getByRole("button", { name: "この内容で複製" }));
  await screen.findByText("Start failed");
  const selected = {
    ...summary("job", "Event（コピー）"),
    status: "queued" as const,
    options: state.saved[0]!,
    resources: [],
    sharedReferences: [],
  };
  state.start.mockResolvedValueOnce(selected);
  fireEvent.click(screen.getByRole("button", { name: "この内容で複製" }));
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByText("開始待ち");
  expect(state.start.mock.calls).toEqual([
    [{ id: "p", jobId: "job", requestKey: "job" }],
    [{ id: "p", jobId: "job", requestKey: "job" }],
  ]);
  expect(screen.queryByText("Start failed")).toBeNull();
  state.summary = {
    ...summary("job", "Event（コピー）"),
    status: "running",
    preparedCount: 2,
    totalCount: 5,
  };
  await act(async () => {
    await view.client.invalidateQueries();
  });
  await dialog.findByText("複製中");
  expect(dialog.getByRole("progressbar").getAttribute("value")).toBe("2");
  expect(dialog.getByRole("progressbar").getAttribute("max")).toBe("5");
});

it("returns from preview to settings and stops progress reads until another preview is selected", async () => {
  state.value = "2026-09-08T03:04:56.789Z";
  const view = mount("Asia/Tokyo");
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  await screen.findByLabelText("starts_at（datetime）");
  fireEvent.click(screen.getByRole("button", { name: "コピー対象を確認" }));
  await screen.findByRole("button", { name: "設定に戻る" });
  await waitFor(() => expect(state.progressReads).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "設定に戻る" }));
  expect((screen.getByLabelText("複製先の名前") as HTMLInputElement).value).toBe("Event（コピー）");
  const reads = state.progressReads;
  await act(async () => {
    await view.client.invalidateQueries();
  });
  expect(state.progressReads).toBe(reads);
});

it("submits typed variable overrides and workspace-local review time from the clone inputs", async () => {
  state.value = "2026-09-08T03:04:56.789Z";
  state.extraVariables = (
    [
      { key: "budget", type: "number", value: 12 },
      { key: "enabled", type: "boolean", value: true },
      { key: "title", type: "string", value: "Old title" },
      { key: "url", type: "url", value: "https://example.com/old" },
    ] as const
  ).map((variable) => ({
    ...variable,
    id: variable.key,
    workspaceId: "ws",
    projectId: "p",
    revision: 1,
    updatedAt: "",
  }));
  mount("Asia/Tokyo");
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  fireEvent.change(await screen.findByLabelText("budget（number）"), { target: { value: "15.5" } });
  fireEvent.change(screen.getByLabelText("enabled（boolean）"), { target: { value: "false" } });
  fireEvent.change(screen.getByLabelText("title（string）"), { target: { value: "New title" } });
  fireEvent.change(screen.getByLabelText("url（url）"), {
    target: { value: "https://example.com/new" },
  });
  fireEvent.change(screen.getByLabelText("レビュー日（Asia/Tokyo）"), {
    target: { value: "2026-09-09T12:45" },
  });
  fireEvent.click(screen.getByRole("button", { name: "コピー対象を確認" }));
  await waitFor(() => expect(state.saved).toHaveLength(1));
  expect(state.saved[0]).toEqual({
    name: "Event（コピー）",
    ownerUserId: null,
    approverUserId: null,
    reviewAt: "2026-09-09T03:45:00.000Z",
    variables: { budget: 15.5, enabled: false, title: "New title", url: "https://example.com/new" },
  });
});
