// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectsPage } from "./projects-page";

const state = vi.hoisted(() => ({ canCreate: false, navigate: vi.fn<(input: unknown) => void>() }));
vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: () => ({
    data: {
      projects: [
        {
          id: "one",
          name: "秋のイベント",
          description: "参加者募集",
          itemCount: 3,
          updatedAt: "2026-09-12",
        },
      ],
      allowedActions: { create: state.canCreate },
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/projects">{children}</a>,
  useNavigate: () => state.navigate,
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/lib/workspace-time", () => ({
  useWorkspaceFormatters: () => ({ formatDateTime: (value: string) => value }),
}));
vi.mock("./program-api", () => ({
  projectsQueryOptions: () => ({}),
  useCreateProject: () => ({}),
}));
vi.mock("./project-brief-list-page", () => ({ ProjectBriefsPage: () => null }));
afterEach(() => {
  cleanup();
  state.canCreate = false;
  state.navigate.mockClear();
});
it("searches descriptions, explains no matches and clears the query without offering unauthorized creation", () => {
  render(
    <ProjectsPage search={{ view: "projects" } as Parameters<typeof ProjectsPage>[0]["search"]} />,
  );
  expect(screen.queryByRole("button", { name: "施策を作成" })).toBeNull();
  fireEvent.change(screen.getByLabelText("施策を検索"), { target: { value: "参加者募集" } });
  expect(screen.getByRole("cell", { name: "秋のイベント" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("施策を検索"), { target: { value: "該当なし" } });
  expect(screen.getByText("検索条件に一致する施策はありません")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
  expect(screen.getByRole("cell", { name: "秋のイベント" })).toBeTruthy();
});
it("retains the create action for authorized users", () => {
  state.canCreate = true;
  render(
    <ProjectsPage search={{ view: "projects" } as Parameters<typeof ProjectsPage>[0]["search"]} />,
  );
  expect(screen.getByRole("button", { name: "施策を作成" })).toBeTruthy();
});

it("restores URL queries and synchronizes navigation changes", () => {
  const search = { view: "projects", q: "参加者" } as Parameters<typeof ProjectsPage>[0]["search"];
  const { rerender } = render(<ProjectsPage search={search} />);
  expect((screen.getByLabelText("施策を検索") as HTMLInputElement).value).toBe("参加者");
  fireEvent.change(screen.getByLabelText("施策を検索"), { target: { value: "秋" } });
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/projects",
    search: { ...search, q: "秋" },
    replace: true,
  });
  rerender(<ProjectsPage search={{ ...search, q: "別の条件" }} />);
  expect((screen.getByLabelText("施策を検索") as HTMLInputElement).value).toBe("別の条件");
});
