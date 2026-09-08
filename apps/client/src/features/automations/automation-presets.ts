import { Activity, Clock3, Sparkles, UserPlus } from "lucide-react";

import { type AutomationDefinition } from "@openengage/core/automations";

import { chainEdges, delayNode, emailNode, sourceNode } from "./automation-graph";
import { type EmailTemplateOption } from "./automation-types";

export type PresetId = "welcome" | "cart" | "purchase" | "reengagement";

export const presets: Array<{
  id: PresetId;
  name: string;
  description: string;
  icon: typeof UserPlus;
}> = [
  {
    id: "welcome",
    name: "ウェルカムシリーズ",
    description: "連絡先の登録直後と2日後にメールを届けます。",
    icon: UserPlus,
  },
  {
    id: "cart",
    name: "カゴ落ちフォロー",
    description: "cart_abandonedを受け取り、購入がなければ1時間後に送信します。",
    icon: Clock3,
  },
  {
    id: "purchase",
    name: "購入フォローアップ",
    description: "purchase_completedの翌日にサンクスメールを送信します。",
    icon: Sparkles,
  },
  {
    id: "reengagement",
    name: "休眠顧客の再活性化",
    description: "行動が30日間ない顧客へ再訪を促します。",
    icon: Activity,
  },
];

export function createPresetAutomation(
  name: string,
  preset: PresetId,
  template: EmailTemplateOption,
): AutomationDefinition {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (preset === "welcome") {
    return {
      name,
      description: "新しく登録された連絡先向けのウェルカムシリーズ",
      timezone,
      nodes: [
        sourceNode({ source: "contact_created", reentry: "once" }, 80, 180),
        emailNode("welcome-1", { x: 350, y: 180 }, template),
        delayNode("welcome-wait", 2_880, 620, 180),
        emailNode("welcome-2", { x: 890, y: 180 }, template),
      ],
      edges: chainEdges(["source", "welcome-1", "welcome-wait", "welcome-2"]),
    };
  }
  if (preset === "cart") {
    return {
      name,
      description: "カゴ落ち後、購入完了がない連絡先へのフォロー",
      timezone,
      nodes: [
        sourceNode(
          { source: "api_event", eventName: "cart_abandoned", reentry: "every_time" },
          60,
          180,
        ),
        delayNode("cart-wait", 60, 320, 180),
        {
          id: "purchase-check",
          type: "decision",
          position: { x: 580, y: 180 },
          config: {
            event: "custom_event",
            resourceId: "purchase_completed",
            withinMinutes: 1,
          },
        },
        emailNode("cart-email", { x: 850, y: 300 }, template),
      ],
      edges: [
        { id: "source-cart-wait", source: "source", target: "cart-wait", branch: "next" },
        {
          id: "cart-wait-check",
          source: "cart-wait",
          target: "purchase-check",
          branch: "next",
        },
        {
          id: "cart-timeout-email",
          source: "purchase-check",
          target: "cart-email",
          branch: "timeout",
        },
      ],
    };
  }
  if (preset === "purchase") {
    return {
      name,
      description: "購入後のサンクス・フォローアップ",
      timezone,
      nodes: [
        sourceNode(
          { source: "api_event", eventName: "purchase_completed", reentry: "every_time" },
          80,
          180,
        ),
        delayNode("purchase-wait", 1_440, 360, 180),
        emailNode("purchase-email", { x: 650, y: 180 }, template),
      ],
      edges: chainEdges(["source", "purchase-wait", "purchase-email"]),
    };
  }
  return {
    name,
    description: "30日間行動がない連絡先向けの再エンゲージメント",
    timezone,
    nodes: [
      sourceNode({ source: "contact_inactive", days: 30, reentry: "once" }, 80, 180),
      emailNode("reengagement-email", { x: 380, y: 180 }, template),
    ],
    edges: chainEdges(["source", "reengagement-email"]),
  };
}

export function createBlankAutomation(name: string, timeZone: string): AutomationDefinition {
  return {
    name,
    description: "",
    timezone: timeZone,
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 80, y: 180 },
        config: {
          source: "batch",
          audience: {
            kind: "filter",
            filter: {
              kind: "condition",
              field: "status",
              operator: "eq",
              value: "active",
            },
          },
          schedule: { kind: "now" },
          reentry: "once",
        },
      },
    ],
    edges: [],
  };
}
