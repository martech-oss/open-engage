// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AutomationGenerationResult } from "@openengage/core/automations";

import { AutomationAiSheet, type AutomationAiSheetProps } from "./automation-ai-sheet";

const generate = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: unknown) => Promise<AutomationGenerationResult>>(),
  isPending: false,
}));
vi.mock("./automation-api", () => ({ useGenerateAutomation: () => generate }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
beforeEach(() => generate.mutateAsync.mockReset());
afterEach(cleanup);

function props(): AutomationAiSheetProps {
  return {
    open: true,
    mode: "create",
    entityId: "automation-a",
    projectId: "project-a",
    briefRevision: 1,
    onOpenChange: vi.fn<AutomationAiSheetProps["onOpenChange"]>(),
    onApply: vi.fn<AutomationAiSheetProps["onApply"]>(async () => {}),
  };
}
function ready(name = "Welcome flow"): Extract<AutomationGenerationResult, { status: "ready" }> {
  return {
    status: "ready",
    summary: "Welcome new contacts",
    definition: {
      name,
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
      ],
      edges: [],
    },
    assumptions: ["New contacts only"],
    warnings: ["Review before publishing"],
  };
}
function needsInput(): Extract<AutomationGenerationResult, { status: "needs_input" }> {
  const resources = [
    {
      requestId: "email",
      kind: "email_template" as const,
      label: "Email template",
      reason: "Choose content",
      canOmit: false,
    },
    {
      requestId: "tag",
      kind: "tag" as const,
      label: "Optional tag",
      reason: "Optional classification",
      canOmit: true,
    },
  ];
  return {
    status: "needs_input",
    summary: "Choose references",
    plannedSteps: ["Send welcome email"],
    continuation: { summary: "Choose references", plannedSteps: ["Send welcome email"], resources },
    resources: resources.map((request, index) => ({
      ...request,
      options: index === 0 ? [{ id: "template-1", name: "Welcome template" }] : [],
    })),
  };
}
function submit(prompt = "Welcome contacts") {
  fireEvent.change(screen.getByLabelText("実現したいこと"), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "提案を生成" }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("resolves required and omitted references, previews the proposal, and applies only on request", async () => {
  const user = userEvent.setup();
  const input = props();
  generate.mutateAsync.mockResolvedValueOnce(needsInput()).mockResolvedValueOnce(ready());
  render(<AutomationAiSheet {...input} />);
  submit();
  await screen.findByText("Choose references");
  const regenerate = screen.getByRole("button", { name: "選択内容で再生成" }) as HTMLButtonElement;
  expect(regenerate.disabled).toBe(true);
  await user.click(screen.getAllByRole("combobox")[0]!);
  await user.click(await screen.findByRole("option", { name: "Welcome template" }));
  expect(regenerate.disabled).toBe(true);
  await user.click(screen.getAllByRole("combobox")[1]!);
  await user.click(await screen.findByRole("option", { name: "このステップを省略" }));
  expect(regenerate.disabled).toBe(false);
  await user.click(regenerate);
  await screen.findByText("Welcome flow");
  expect(screen.getByText("New contacts only")).toBeTruthy();
  expect(screen.getByText("Review before publishing")).toBeTruthy();
  expect(generate.mutateAsync.mock.calls[1]?.[0]).toEqual({
    mode: "create",
    prompt: "Welcome contacts",
    projectId: "project-a",
    briefRevision: 1,
    continuation: needsInput().continuation,
    resolutions: [
      { requestId: "email", decision: "select", resourceId: "template-1" },
      { requestId: "tag", decision: "omit" },
    ],
  });
  expect(input.onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "この内容で下書きを作成" }));
  await waitFor(() => expect(input.onApply).toHaveBeenCalledWith(ready().definition));
  expect(input.onOpenChange).not.toHaveBeenCalled();
});

it.each(["entity", "project", "revision", "mode", "reopen"] as const)(
  "discards a deferred generation after %s changes and accepts the current request",
  async (change) => {
    const old = deferred<AutomationGenerationResult>();
    generate.mutateAsync
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(ready("Current flow"));
    const input = props();
    const view = render(<AutomationAiSheet {...input} />);
    submit("Old prompt");
    const next = { ...input };
    if (change === "entity") next.entityId = "automation-b";
    if (change === "project") next.projectId = "project-b";
    if (change === "revision") next.briefRevision = 2;
    if (change === "mode") {
      next.mode = "refine";
      next.currentDefinition = ready().definition;
    }
    if (change === "reopen") view.rerender(<AutomationAiSheet {...input} open={false} />);
    view.rerender(<AutomationAiSheet {...next} />);
    expect((screen.getByLabelText("実現したいこと") as HTMLTextAreaElement).value).toBe("");
    submit("Current prompt");
    await screen.findByText("Current flow");
    await act(async () => {
      old.resolve(ready("Stale flow"));
      await old.promise;
    });
    expect(screen.queryByText("Stale flow")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: next.mode === "refine" ? "キャンバスに適用" : "この内容で下書きを作成",
      }),
    );
    await waitFor(() =>
      expect(input.onApply).toHaveBeenCalledWith(ready("Current flow").definition),
    );
  },
);

it("ignores stale generation errors after the sheet reopens", async () => {
  const old = deferred<AutomationGenerationResult>();
  generate.mutateAsync.mockReturnValueOnce(old.promise);
  const input = props();
  const view = render(<AutomationAiSheet {...input} />);
  submit();
  view.rerender(<AutomationAiSheet {...input} open={false} />);
  view.rerender(<AutomationAiSheet {...input} />);
  await act(async () => {
    old.reject(new Error("Old failure"));
    await old.promise.catch(() => {});
  });
  expect(screen.queryByText("Old failure")).toBeNull();
  expect((screen.getByRole("button", { name: "提案を生成" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("retains an accepted proposal after apply fails so it can be retried, then resets explicitly", async () => {
  const input = props();
  const onApply = vi
    .fn<AutomationAiSheetProps["onApply"]>()
    .mockRejectedValueOnce(new Error("Save failed"))
    .mockResolvedValueOnce(undefined);
  generate.mutateAsync.mockResolvedValue(ready());
  render(<AutomationAiSheet {...input} onApply={onApply} />);
  submit();
  await screen.findByText("Welcome flow");
  fireEvent.click(screen.getByRole("button", { name: "この内容で下書きを作成" }));
  await screen.findByText("Save failed");
  expect(screen.getByText("Welcome flow")).toBeTruthy();
  const apply = screen.getByRole("button", { name: "この内容で下書きを作成" }) as HTMLButtonElement;
  expect(apply.disabled).toBe(false);
  fireEvent.click(apply);
  await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
  expect(onApply.mock.calls[1]?.[0]).toEqual(ready().definition);
  expect(screen.queryByText("Save failed")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "最初からやり直す" }));
  expect(screen.queryByText("Welcome flow")).toBeNull();
  expect((screen.getByLabelText("実現したいこと") as HTMLTextAreaElement).value).toBe("");
});
