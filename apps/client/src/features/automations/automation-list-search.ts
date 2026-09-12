import type { AutomationRow } from "@openengage/core/automations";

export type AutomationListSearch = {
  q?: string | undefined;
  status?: AutomationRow["status"] | undefined;
};

export const automationStatusOptions = [
  { value: "all", label: "すべての状態" },
  { value: "active", label: "稼働中" },
  { value: "paused", label: "一時停止" },
  { value: "draft", label: "下書き" },
  { value: "archived", label: "アーカイブ" },
];

export function validateAutomationListSearch(
  search: Record<string, unknown>,
): AutomationListSearch {
  return {
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    status: ["active", "paused", "draft", "archived"].includes(String(search.status))
      ? (search.status as AutomationRow["status"])
      : undefined,
  };
}

export function filterAutomations(
  rows: AutomationRow[],
  search: AutomationListSearch,
): AutomationRow[] {
  const query = search.q?.trim().toLocaleLowerCase() ?? "";
  return rows.filter(
    (row) =>
      (!search.status || row.status === search.status) &&
      (!query || `${row.name} ${row.description}`.toLocaleLowerCase().includes(query)),
  );
}
