import type { DealSummary, DealTask, DealTaskListItem } from "@openengage/core/deals";

export type PipelineCreateResult = { kind: "conflict" } | { kind: "ok"; id: string };

export type PipelineUpdateResult =
  | "not_found"
  | "conflict"
  | "default_required"
  | "stage_in_use"
  | "ok";

export type PipelineArchiveResult = "not_found" | "last" | "in_use" | "ok";

/**
 * One deal row joined with its pipeline/stage/owner/contact/company names and
 * open-task counters. Repository rows use the same camelCase business shape
 * exposed by core.
 */
export type DealRow = DealSummary;

export type DealTaskRow = DealTask;

export type DealTaskListItemRow = DealTaskListItem;

export interface DealListSummaryRow {
  openCount: number;
  openValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
}

export interface DealPipelineRow {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface DealStageRow {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  probability: number;
}

export interface DealContactOptionRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface DealCompanyOptionRow {
  id: string;
  name: string;
  domain: string | null;
}

export interface DealMemberOptionRow {
  id: string;
  name: string;
  email: string;
}

export interface DealOptionRows {
  pipelines: DealPipelineRow[];
  stages: DealStageRow[];
  contacts: DealContactOptionRow[];
  companies: DealCompanyOptionRow[];
  members: DealMemberOptionRow[];
}
