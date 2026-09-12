// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { EmailTemplatesPage } from "./email-pages";

vi.mock("@tanstack/react-query", () => ({
  useSuspenseQuery: () => ({ data: [], isFetching: false }),
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("./email-api", () => ({
  emailTemplateOptionsQueryOptions: () => ({}),
  emailVariablesListQueryOptions: () => ({}),
}));
vi.mock("./email-tables", () => ({ TemplateTable: () => null }));
vi.mock("./email-variable-tables", () => ({ VariableReference: () => null }));
vi.mock("./email-archived-resources", () => ({ ArchivedResources: () => null }));
vi.mock("./email-forms", () => ({
  TemplateForm: ({
    open,
    initialAiOpen,
    onOpenChange,
  }: {
    open: boolean;
    initialAiOpen: boolean;
    onOpenChange: (value: boolean) => void;
  }) =>
    open ? (
      <dialog open aria-label={initialAiOpen ? "AI作成" : "手動作成"}>
        <button onClick={() => onOpenChange(false)}>閉じる</button>
      </dialog>
    ) : null,
  VariableForm: () => null,
}));
afterEach(cleanup);
it("offers manual and AI creation from one keyboard-accessible entry and resets each form session", async () => {
  const user = userEvent.setup();
  render(<EmailTemplatesPage />);
  screen.getByRole("button", { name: "メールを作成" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "AIでメールを作成" }));
  expect(screen.getByRole("dialog", { name: "AI作成" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  await user.click(screen.getByRole("button", { name: "メールを作成" }));
  await user.click(await screen.findByRole("menuitem", { name: "手動で作成" }));
  expect(screen.getByRole("dialog", { name: "手動作成" })).toBeTruthy();
});
