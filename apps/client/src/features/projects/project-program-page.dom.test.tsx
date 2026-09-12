// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectProgramPage } from "./project-program-page";

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

const state = vi.hoisted(() => ({ published: true }));
vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: () => ({
    data: {
      project: { name: "ウェビナー", description: "" },
      program: state.published ? { publishedVersion: 1, rowVersion: 1, versions: [] } : null,
      brief: null,
      allowedActions: { manageMembers: false, editDefinition: false, publishDefinition: false },
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/projects">{children}</a>,
}));
vi.mock("./program-api", () => ({
  programQueryOptions: () => ({}),
  useSaveProgram: () => ({}),
  usePublishProgram: () => ({}),
}));
vi.mock("./program-cohort-panel", () => ({ ProgramCohortPanel: () => <div>成果の内容</div> }));
vi.mock("./program-members-panel", () => ({ ProgramMembersPanel: () => <div>参加者の内容</div> }));
vi.mock("./program-definition-editor", () => ({
  ProgramDefinitionEditor: () => <div>定義の内容</div>,
}));
vi.mock("./program-form-bindings", () => ({
  ProgramFormBindings: () => <div>フォームの内容</div>,
}));
vi.mock("./project-brief-pages", () => ({ ProjectBriefDetailPage: () => null }));
vi.mock("./variable-settings", () => ({ VariableSettings: () => <div>変数の内容</div> }));
vi.mock("./clone-panel", () => ({
  ProjectClonePanel: ({ canEdit }: { canEdit: boolean }) => (
    <div>複製履歴 {canEdit ? "編集可" : "閲覧のみ"}</div>
  ),
}));
afterEach(() => {
  cleanup();
  state.published = true;
});
it("opens published projects on outcomes and groups configuration under settings", () => {
  render(<ProjectProgramPage id="project" />);
  expect(screen.getByRole("tab", { name: "成果" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("tab", { name: "変数" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "設定" }));
  expect(screen.getByText("定義の内容")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "変数" }));
  expect(screen.getByText("変数の内容")).toBeTruthy();
});
it("opens unpublished projects on configuration and retains the member publication prerequisite", () => {
  state.published = false;
  render(<ProjectProgramPage id="project" />);
  expect(screen.getByRole("tab", { name: "設定" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "参加者" }));
  expect(screen.getByText(/保存・公開してから参加者/)).toBeTruthy();
});
it("opens existing clone history from page actions with read-only permissions", async () => {
  render(<ProjectProgramPage id="project" />);
  fireEvent.click(screen.getByRole("button", { name: "施策の操作" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "複製・複製履歴" }));
  expect(screen.getByText("複製履歴 閲覧のみ")).toBeTruthy();
});
