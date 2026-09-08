// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkspaceTimeProvider } from "@/lib/workspace-time";
import type { ProjectCloneOptions } from "@openengage/core/projects";

import { ProjectClonePanel } from "./clone-panel";

const { state } = vi.hoisted(() => ({ state: { value: "", saved: [] as ProjectCloneOptions[] } }));
vi.mock("./clone-api", () => ({
  projectCloneListQueryOptions: () => ({ queryKey: ["clone-list"], queryFn: async () => [] }),
  projectCloneQueryOptions: () => ({ queryKey: ["clone-job"], queryFn: async () => null }),
  usePreviewProjectClone: () => ({
    mutateAsync: async ({ options }: { options: ProjectCloneOptions }) => {
      state.saved.push(options);
      return { id: "job", status: "preview", options, resources: [], sharedReferences: [] };
    },
  }),
  useStartProjectClone: () => ({ mutateAsync: vi.fn<() => Promise<void>>() }),
  useRetryProjectClone: () => ({ mutate: vi.fn<() => void>() }),
}));
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
        ],
      },
    }),
  }),
}));
afterEach(() => {
  cleanup();
  state.saved = [];
});
function mount(timeZone: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WorkspaceTimeProvider value={{ timeZone, renderedAt: "2026-09-08T00:00:00Z" }}>
        <ProjectClonePanel projectId="p" projectName="Event" />
      </WorkspaceTimeProvider>
    </QueryClientProvider>,
  );
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
