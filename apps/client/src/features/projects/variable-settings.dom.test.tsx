// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { VariableSettings } from "./variable-settings";
const { state } = vi.hoisted(() => ({
  state: { canEdit: true, previewed: false, saved: [] as unknown[] },
}));
vi.mock("./variable-api", () => ({
  variablesQueryOptions: () => ({
    queryKey: ["variables"],
    queryFn: async () => ({
      canEdit: state.canEdit,
      definitions: [
        {
          id: "w",
          workspaceId: "ws",
          projectId: null,
          key: "title",
          type: "string",
          value: "Workspace",
          revision: 3,
          updatedAt: "",
        },
      ],
      effective: {
        schemaVersion: 1,
        projectId: "p",
        values: [
          {
            id: "w",
            workspaceId: "ws",
            projectId: null,
            key: "title",
            type: "string",
            value: "Workspace",
            revision: 3,
            updatedAt: "",
          },
        ],
      },
    }),
  }),
  variableUsesQueryOptions: () => ({
    queryKey: ["uses"],
    queryFn: async () => [
      {
        resourceType: "landing_page",
        resourceId: "lp",
        name: "Event page",
        projectId: "p",
        versionId: "v1",
        published: true,
        references: [{ kind: "variable", key: "title", type: "string" }],
        snapshot: null,
        dependencyPath: ["form:signup"],
        diagnostics: ["Invalid variable expression"],
      },
    ],
  }),
  useSaveVariable: () => ({
    mutateAsync: async (input: unknown) => {
      state.saved.push(input);
    },
  }),
  useDeleteVariable: () => ({
    mutateAsync: async (input: unknown) => {
      state.saved.push(input);
    },
  }),
  usePreviewVariableImpact: () => ({
    mutateAsync: async () => {
      state.previewed = true;
      return [
        {
          resourceType: "landing_page",
          resourceId: "lp",
          name: "Event page",
          versionId: "v1",
          before: "Workspace",
          after: "Project",
          requiresRepublish: true,
          error: null,
          dependencyPath: ["form:signup"],
          diagnostics: ["Invalid variable expression"],
        },
      ];
    },
  }),
}));
afterEach(() => {
  cleanup();
  state.canEdit = true;
  state.previewed = false;
  state.saved = [];
});
const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <VariableSettings projectId="p" />
    </QueryClientProvider>,
  );
it("previews inherited overrides and saves only after displaying the publication diff", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "title を上書き" }));
  fireEvent.change(screen.getByLabelText("値"), { target: { value: "Project" } });
  fireEvent.click(screen.getByRole("button", { name: "影響を確認" }));
  await screen.findByText("再公開が必要");
  expect(state.saved).toEqual([]);
  expect(screen.getByText("Workspace → Project")).toBeTruthy();
  expect(screen.getByText(/form:signup/)).toBeTruthy();
  expect(screen.getByText("Invalid variable expression")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(() =>
    expect(state.saved).toEqual([
      { projectId: "p", key: "title", type: "string", value: "Project", expectedRevision: 0 },
    ]),
  );
});
it("uses server capability to hide writes while still exposing values and uses", async () => {
  state.canEdit = false;
  mount();
  await screen.findAllByText("Workspace");
  expect(screen.queryByRole("button", { name: "変数を追加" })).toBeNull();
  expect(screen.queryByRole("button", { name: "title を上書き" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "title の使用箇所" }));
  expect(await screen.findByText(/Event page/)).toBeTruthy();
  expect(screen.getByText(/form:signup/)).toBeTruthy();
  expect(screen.getByText("Invalid variable expression")).toBeTruthy();
});
