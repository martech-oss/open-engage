// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  PROJECT_PROGRAM_TEMPLATES,
  type ProjectProgramDefinition,
} from "@openengage/core/projects";

import * as Editor from "./program-definition-editor";
afterEach(cleanup);
it("keeps definition edits distinct from confirmed publication and offers status graph fields", () => {
  expect(Editor.ProgramDefinitionEditor).toBeTypeOf("function");
  const save = vi.fn<(definition: ProjectProgramDefinition) => void>();
  const publish = vi.fn<() => void>();
  render(
    <Editor.ProgramDefinitionEditor
      definition={PROJECT_PROGRAM_TEMPLATES.event}
      editable
      publishable
      publishedVersion={1}
      busy={false}
      onSave={save}
      onPublish={publish}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "この定義を公開" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByLabelText("変更内容を確認しました。既存参加者は元の定義版を維持します。"),
  );
  fireEvent.click(screen.getByRole("button", { name: "この定義を公開" }));
  expect(publish).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("初期ステータス"), { target: { value: "registered" } });
  fireEvent.change(screen.getByLabelText("初期ステータス"), { target: { value: "invited" } });
  expect(
    (screen.getByRole("button", { name: "この定義を公開" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByLabelText("初期ステータス")).toBeTruthy();
  expect(screen.getAllByLabelText("成果として数える")).toHaveLength(4);
});

it("renames status IDs and rewrites incoming edges and the initial status before saving", () => {
  const save = vi.fn<(definition: ProjectProgramDefinition) => void>();
  render(
    <Editor.ProgramDefinitionEditor
      definition={PROJECT_PROGRAM_TEMPLATES.event}
      editable
      publishable
      publishedVersion={1}
      busy={false}
      onSave={save}
      onPublish={() => {}}
    />,
  );
  fireEvent.change(screen.getAllByLabelText("ステータスID")[1]!, {
    target: { value: "signed_up" },
  });
  fireEvent.change(screen.getAllByLabelText("ステータスID")[0]!, {
    target: { value: "invitation" },
  });
  fireEvent.click(screen.getByRole("button", { name: "定義を下書き保存" }));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]![0]).toMatchObject({
    initialStatusId: "invitation",
    statuses: [
      { id: "invitation", nextStatusIds: ["signed_up"] },
      { id: "signed_up" },
      { id: "attended" },
      { id: "absent" },
    ],
  });
});
it("deletes incoming references and selects a valid initial status when deleting it", () => {
  const save = vi.fn<(definition: ProjectProgramDefinition) => void>();
  render(
    <Editor.ProgramDefinitionEditor
      definition={PROJECT_PROGRAM_TEMPLATES.event}
      editable
      publishable
      publishedVersion={1}
      busy={false}
      onSave={save}
      onPublish={() => {}}
    />,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "削除" })[1]!);
  fireEvent.click(screen.getByRole("button", { name: "定義を下書き保存" }));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]![0].statuses[0]?.nextStatusIds).toEqual([]);
  fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "定義を下書き保存" }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]![0].initialStatusId).toBe("attended");
});
