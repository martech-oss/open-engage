import { Link, useNavigate } from "@tanstack/react-router";
import { Pause, Play, Search } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { AutomationRow } from "@openengage/core/automations";

import { useSetAutomationStatus } from "./automation-api";
import { triggerLabel } from "./automation-labels";
import {
  filterAutomations,
  automationStatusOptions,
  type AutomationListSearch,
} from "./automation-list-search";
import { AutomationStatusBadge } from "./automation-status-badge";

export function AutomationMonitoringTable({
  automations,
  search,
}: {
  automations: AutomationRow[];
  search: AutomationListSearch;
}): ReactNode {
  const navigate = useNavigate();
  const { formatDateTime } = useWorkspaceFormatters();
  const setAutomationStatus = useSetAutomationStatus();
  async function changeStatus(automation: AutomationRow): Promise<void> {
    const status = automation.status === "active" ? "paused" : "active";
    try {
      await setAutomationStatus.mutateAsync({ id: automation.id, status });
      toast.success(status === "active" ? "オートメーションを再開しました" : "一時停止しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "更新できませんでした"));
    }
  }

  const visibleAutomations = filterAutomations(automations, search);
  const columns: DataTableColumn<AutomationRow>[] = [
    {
      key: "name",
      header: "フロー名",
      cellClassName: "h-14 min-w-56",
      cell: (row) => (
        <div className="max-w-80 min-w-0">
          <Link
            to="/automations/$id"
            params={{ id: row.id }}
            search={search}
            className="block truncate font-medium hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {row.name}
          </Link>
          {row.description ? (
            <p className="truncate text-xs text-muted-foreground">{row.description}</p>
          ) : null}
        </div>
      ),
    },
    { key: "status", header: "状態", cell: (row) => <AutomationStatusBadge status={row.status} /> },
    {
      key: "trigger",
      header: "開始方法",
      cellClassName: "text-muted-foreground",
      cell: (row) => triggerLabel(row.triggerSource),
    },
    ...(
      [
        ["enrollmentCount", "登録"],
        ["activeCount", "進行中"],
        ["completedCount", "完了"],
      ] as const
    ).map(([key, header]) => ({
      key,
      header,
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
      cell: (row: AutomationRow) => row[key].toLocaleString(),
    })),
    {
      key: "updatedAt",
      header: "更新日時",
      cellClassName: "text-xs text-muted-foreground",
      cell: (row) => formatDateTime(row.updatedAt),
    },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      cell: (row) =>
        row.status === "active" || row.status === "paused" ? (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={setAutomationStatus.isPending}
            aria-label={`${row.name}を${row.status === "active" ? "一時停止" : "再開"}`}
            onClick={() => void changeStatus(row)}
          >
            {row.status === "active" ? <Pause /> : <Play />}
          </Button>
        ) : null,
    },
  ];

  return (
    <section aria-label="フロー一覧" className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="フローを検索"
            placeholder="フロー名・説明で検索"
            value={search.q ?? ""}
            onChange={(event) =>
              void navigate({
                to: "/automations",
                search: { ...search, q: event.target.value || undefined },
                replace: true,
              })
            }
          />
        </InputGroup>
        <Select
          items={automationStatusOptions}
          value={search.status ?? "all"}
          onValueChange={(value) =>
            void navigate({
              to: "/automations",
              search: {
                ...search,
                status: value === "all" ? undefined : (value as AutomationRow["status"]),
              },
              replace: true,
            })
          }
        >
          <SelectTrigger aria-label="フローの状態" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {automationStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <output className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleAutomations.length.toLocaleString()} / {automations.length.toLocaleString()} 件
        </output>
      </div>
      <DataTable
        compact
        columns={columns}
        rows={visibleAutomations}
        rowKey={(row) => row.id}
        caption="オートメーションの稼働状況"
        emptyTitle={
          automations.length ? "条件に一致するフローがありません" : "フローはまだありません"
        }
        emptyDescription={
          automations.length
            ? "検索語や状態の条件を変更してください。"
            : "「フローを作成」から最初のフローを作成してください。"
        }
        className="min-w-[960px]"
      />
    </section>
  );
}
