import type { GradingOperator, ScoringEventType, ScoringMatchType } from "@openengage/core/scoring";

export const SCORING_EVENT_LABELS: Record<ScoringEventType, string> = {
  page_viewed: "ページ閲覧",
  form_submitted: "フォーム送信",
  email_opened: "メール開封",
  email_clicked: "メールクリック",
  email_replied: "メール返信",
  custom_redirect_clicked: "計測用リンクのクリック",
  custom_event: "カスタムイベント",
};

export const SCORING_MATCH_LABELS: Record<ScoringMatchType, string> = {
  any: "すべて",
  resource: "対象IDが一致",
  url_exact: "URLが完全一致",
  url_contains: "URLに含む",
  url_starts_with: "URLが前方一致",
};

export const GRADING_OPERATOR_LABELS: Record<GradingOperator, string> = {
  eq: "等しい",
  neq: "等しくない",
  contains: "含む",
  starts_with: "前方一致",
  in: "いずれかに一致（カンマ区切り）",
  gt: "より大きい",
  gte: "以上",
  lt: "より小さい",
  lte: "以下",
  exists: "値がある",
  not_exists: "値がない",
};

export const GRADING_FIELD_LABELS: Record<string, string> = {
  email: "メールアドレス",
  first_name: "名",
  last_name: "姓",
  phone: "電話番号",
  stage: "ステージ",
  score: "スコア",
  custom_field: "カスタムフィールド",
};

/** Only the URL match types need a URL; `resource` takes an id instead. */
export function matchValueLabel(matchType: ScoringMatchType): string {
  if (matchType === "resource") return "対象ID";
  return matchType === "any" ? "一致条件の値" : "URL";
}
