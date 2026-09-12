// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "./data-table";

type Row = { id: string; name: string };

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "名前", cell: (row) => row.name, sortValue: (row) => row.name },
];
const rows = [
  { id: "b", name: "Beta" },
  { id: "a", name: "Alpha" },
];

afterEach(cleanup);

describe("DataTable sorting authority", () => {
  it("keeps local sorting for a complete small list", async () => {
    renderTable();

    await userEvent.click(screen.getByRole("button", { name: /名前/ }));

    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("does not offer current-page sorting when pagination makes the server authoritative", () => {
    renderTable({
      hasNextPage: true,
      hasPreviousPage: false,
      onNext: () => undefined,
      onPrevious: () => undefined,
    });

    expect(screen.queryByRole("button", { name: /名前/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "名前" }).getAttribute("aria-sort")).toBeNull();
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Beta", "Alpha"]);
  });
});

function renderTable(pagination?: Parameters<typeof DataTable<Row>>[0]["pagination"]): void {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption="テスト"
      emptyTitle="空"
      {...(pagination ? { pagination } : {})}
    />,
  );
}

describe("row interactions", () => {
  it("keeps child actions independent from opening a record", async () => {
    const opened: string[] = [];
    let actionCount = 0;
    render(
      <DataTable
        rows={rows.slice(0, 1)}
        rowKey={(row) => row.id}
        caption="操作のある表"
        emptyTitle="空"
        onRowClick={(row) => opened.push(row.id)}
        columns={[
          ...columns,
          {
            key: "actions",
            header: "操作",
            cell: () => <button onClick={() => actionCount++}>一時停止</button>,
          },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "一時停止" });
    await userEvent.click(button);
    await userEvent.keyboard("{Enter}");
    expect(actionCount).toBe(2);
    expect(opened).toEqual([]);
    const row = screen.getAllByRole("row")[1]!;
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(opened).toEqual(["b"]);
  });
});
