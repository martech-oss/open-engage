import { type AutomationEdge, type AutomationNode } from "@openengage/core/automations";

export function nodeLabel(node: AutomationNode): string {
  if (node.type === "source") return triggerLabel(node.config.source);
  if (node.type === "delay") {
    return node.config.mode === "relative"
      ? formatDuration(node.config.minutes)
      : "指定日時まで待機";
  }
  if (node.type === "decision") return `${eventLabel(node.config.event)}を待つ`;
  if (node.type === "condition") return `${node.config.field} を判定`;
  if (node.config.action === "handoff_to_sales") return "営業へ引き継ぐ";
  if (node.config.action === "send_email") return "メールを送信";
  if (node.config.action === "change_score")
    return `スコア ${node.config.amount >= 0 ? "+" : ""}${node.config.amount}`;
  return node.config.action.replaceAll("_", " ");
}

export function nodeTypeLabel(type: AutomationNode["type"]): string {
  return {
    source: "開始条件",
    action: "アクション",
    condition: "条件分岐",
    decision: "行動待機",
    delay: "待機",
  }[type];
}

export function triggerLabel(source: string | null): string {
  if (!source) return "未公開";
  return (
    {
      contact_created: "連絡先が登録されたとき",
      form_submitted: "フォームが送信されたとき",
      segment_joined: "セグメントに参加したとき",
      api_event: "APIイベントを受け取ったとき",
      webhook_event: "Webhookイベントを受け取ったとき",
      contact_inactive: "一定期間行動がないとき",
    }[source] ?? source
  );
}

function eventLabel(
  event: Extract<AutomationNode, { type: "decision" }>["config"]["event"],
): string {
  return {
    opened: "メール開封",
    clicked: "メールクリック",
    replied: "メール返信",
    page_viewed: "ページ閲覧",
    form_submitted: "フォーム送信",
    custom_event: "カスタムイベント",
  }[event];
}

export function formatDuration(minutes: number): string {
  if (minutes % 1_440 === 0) return `${minutes / 1_440}日`;
  if (minutes % 60 === 0) return `${minutes / 60}時間`;
  return `${minutes}分`;
}

export function branchLabel(branch: AutomationEdge["branch"]): string | undefined {
  return { next: undefined, yes: "はい", no: "いいえ", timeout: "時間切れ" }[branch];
}
