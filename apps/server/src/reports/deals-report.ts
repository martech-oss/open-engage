import { ReportsRepository } from "@openengage/database/reports";

import { primitiveString, toFiniteNumber } from "../platform/values";
import { publicRange, rate, type ReportDatabase, type ReportRange } from "./shared";

export async function dealReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
  requestedCurrency?: string,
) {
  const repository = new ReportsRepository(database);
  const currencies = (await repository.listDealCurrencies(workspaceId)).map((row) => row.currency);
  const currency =
    (requestedCurrency && currencies.includes(requestedCurrency) ? requestedCurrency : undefined) ??
    currencies[0] ??
    "JPY";
  const data = await repository.dealsSummary(workspaceId, range, currency);
  const summary = data.summary;
  const taskSummary = data.taskSummary;
  const created = toFiniteNumber(summary["created"]);
  const won = toFiniteNumber(summary["won"]);
  return {
    category: "deals" as const,
    range: publicRange(range),
    currency,
    currencies: currencies.length > 0 ? currencies : [currency],
    summary: {
      created,
      won,
      lost: toFiniteNumber(summary["lost"]),
      wonValue: toFiniteNumber(summary["won_value"]),
      openCount: toFiniteNumber(summary["open_count"]),
      openValue: toFiniteNumber(summary["open_value"]),
      winRate: rate(won, won + toFiniteNumber(summary["lost"])),
      openTasks: toFiniteNumber(taskSummary["open_tasks"]),
      overdueTasks: toFiniteNumber(taskSummary["overdue_tasks"]),
      completedTasks: toFiniteNumber(taskSummary["completed_tasks"]),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      created: toFiniteNumber(row["created"]),
      won: toFiniteNumber(row["won"]),
      lost: toFiniteNumber(row["lost"]),
    })),
    owners: data.owners.map((row) => ({
      id: primitiveString(row["owner_id"]),
      name: primitiveString(row["owner_name"]),
      created: toFiniteNumber(row["created"]),
      won: toFiniteNumber(row["won"]),
      lost: toFiniteNumber(row["lost"]),
      wonValue: toFiniteNumber(row["won_value"]),
      openCount: toFiniteNumber(row["open_count"]),
    })),
    forecast: data.forecast.map((row) => ({
      stageId: primitiveString(row["stage_id"]),
      stageName: primitiveString(row["stage_name"]),
      color: primitiveString(row["color"]),
      probability: toFiniteNumber(row["probability"]),
      dealCount: toFiniteNumber(row["deal_count"]),
      dealValue: toFiniteNumber(row["deal_value"]),
      weightedValue: toFiniteNumber(row["weighted_value"]),
    })),
  };
}
