import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  FolderKanban,
  Layers,
  Settings,
  Spline,
  UsersRound,
} from "lucide-react";

export interface NavLink {
  to: string;
  label: string;
  search?: { view: string };
}
export interface NavSection extends NavLink {
  icon: typeof Activity;
  tabs: readonly NavLink[];
}

/** Stable destinations grouped by the operator's work, independently of URL prefixes. */
export const navigationSections: readonly NavSection[] = [
  { to: "/dashboard", label: "モニター", icon: Activity, tabs: [] },
  { to: "/reports", label: "分析", icon: BarChart3, tabs: [] },
  {
    to: "/projects",
    label: "施策",
    icon: FolderKanban,
    tabs: [
      { to: "/projects", label: "施策一覧", search: { view: "projects" } },
      { to: "/projects", label: "施策ブリーフ", search: { view: "briefs" } },
    ],
  },
  {
    to: "/contacts",
    label: "顧客",
    icon: UsersRound,
    tabs: [
      { to: "/contacts", label: "連絡先" },
      { to: "/companies", label: "会社" },
      { to: "/lists", label: "リスト" },
      { to: "/segments", label: "セグメント" },
      { to: "/tags", label: "タグ" },
      { to: "/scoring/rules", label: "スコアルール" },
      { to: "/scoring/grading", label: "グレード・カテゴリ" },
    ],
  },
  {
    to: "/automations",
    label: "配信・自動化",
    icon: Spline,
    tabs: [
      { to: "/automations", label: "フロー" },
      { to: "/emails/tracking", label: "メール計測" },
      { to: "/emails/archive", label: "メールアーカイブ" },
    ],
  },
  {
    to: "/emails/templates",
    label: "コンテンツ・接点",
    icon: Layers,
    tabs: [
      { to: "/emails/templates", label: "メールテンプレート" },
      { to: "/emails/variables", label: "メッセージ変数" },
      { to: "/website/forms", label: "フォーム" },
      { to: "/website/pages", label: "ランディングページ" },
      { to: "/website/assets", label: "アセット" },
      { to: "/website/messages", label: "サイトメッセージ" },
      { to: "/website/redirects", label: "計測用リンク" },
      { to: "/website/tracking", label: "サイトトラッキング" },
    ],
  },
  {
    to: "/deals",
    label: "営業",
    icon: BriefcaseBusiness,
    tabs: [
      { to: "/deals", label: "パイプライン" },
      { to: "/deal-reports", label: "営業レポート" },
      { to: "/tasks", label: "タスク" },
    ],
  },
];
export const settingsSection: NavSection = {
  to: "/settings",
  label: "設定",
  icon: Settings,
  tabs: [],
};
const allSections = [...navigationSections, settingsSection];
function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}
export function activeSection(pathname: string): NavSection | undefined {
  // Entry routes redirect to these destinations; editor routes share their section.
  const normalized =
    pathname === "/emails" || /^\/emails\/[^/]+\/edit/.test(pathname)
      ? "/emails/templates"
      : pathname === "/website"
        ? "/website/forms"
        : pathname === "/scoring"
          ? "/scoring/rules"
          : pathname;
  let best: NavSection | undefined;
  let bestLength = 0;
  for (const section of allSections) {
    for (const path of [section.to, ...section.tabs.map((tab) => tab.to)]) {
      if (matches(normalized, path) && path.length > bestLength) {
        best = section;
        bestLength = path.length;
      }
    }
  }
  return best;
}
export function isNavTabActive(
  pathname: string,
  section: NavSection,
  tab: NavLink,
  search: Record<string, unknown> = {},
): boolean {
  if (tab.search) {
    return matches(pathname, tab.to) && (search.view ?? "projects") === tab.search.view;
  }
  const exact = section.tabs.some(
    (other) => other.to !== tab.to && other.to.startsWith(`${tab.to}/`),
  );
  return exact ? pathname === tab.to : matches(pathname, tab.to);
}
