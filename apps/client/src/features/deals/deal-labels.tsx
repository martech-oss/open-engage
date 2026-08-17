import { Mail, Phone, UsersRound } from "lucide-react";
import { type ReactNode } from "react";

import { type DealStatus, type DealSummary, type DealTaskType } from "@/features/deals/deal-api";

export function statusLabel(status: DealStatus): string {
  return status === "won" ? "獲得" : status === "lost" ? "失注" : "進行中";
}

export function taskTypeName(type: DealTaskType): string {
  if (type === "call") return "電話";
  if (type === "email") return "メール";
  if (type === "meeting") return "ミーティング";
  return "タスク";
}

export function taskTypeLabel(type: DealTaskType): ReactNode {
  if (type === "call") {
    return (
      <>
        <Phone data-icon="inline-start" />
        {taskTypeName(type)}
      </>
    );
  }
  if (type === "email") {
    return (
      <>
        <Mail data-icon="inline-start" />
        {taskTypeName(type)}
      </>
    );
  }
  if (type === "meeting") {
    return (
      <>
        <UsersRound data-icon="inline-start" />
        {taskTypeName(type)}
      </>
    );
  }
  return taskTypeName(type);
}

export function contactLabel(deal: DealSummary): string {
  return [deal.contactLastName, deal.contactFirstName].filter(Boolean).join(" ");
}
