import type { ProjectCloneResourceKind } from "@openengage/core/projects";

export const kindLabels: Record<ProjectCloneResourceKind, string> = {
  project: "施策",
  brief: "ブリーフ",
  program: "参加者ステータス",
  variable: "変数",
  automation: "Automation",
  automation_version: "Automationの版",
  form: "フォーム",
  form_version: "フォームの版",
  form_binding: "フォームの参加先",
  landing_page: "LP",
  landing_page_version: "LPの版",
  experiment: "LP実験",
  dynamic_content: "動的コンテンツ",
  segment: "リスト・セグメント",
  redirect: "計測リンク",
  email_sequence: "Transactionalテンプレート",
};
export const statusLabels = {
  preview: "確認待ち",
  queued: "開始待ち",
  running: "複製中",
  completed: "完了",
  failed: "失敗",
} as const;
