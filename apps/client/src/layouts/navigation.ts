import { linkOptions } from "@tanstack/react-router";
import {
  BriefcaseBusiness,
  Gauge,
  Globe,
  Mail,
  Settings,
  Spline,
  Target,
  UsersRound,
} from "lucide-react";

export interface NavLink {
  to: string;
  label: string;
}

export interface NavSection extends NavLink {
  icon: typeof Gauge;
  /** Nested sidebar links for the section, empty for leaf sections. */
  tabs: readonly NavLink[];
}

/**
 * The sidebar's six sections plus 設定. Nested `tabs` render under the active
 * section in the sidebar.
 *
 * Single source of truth: the sidebar reads both the sections and the tabs of
 * whichever section {@link activeSection} resolves for the current URL.
 * That resolution walks the tabs too, so ホーム stays lit on `/reports` even
 * though `/reports` does not sit under `/dashboard`.
 */
export const navigationSections: readonly NavSection[] = [
  {
    to: "/dashboard",
    label: "ホーム",
    icon: Gauge,
    tabs: linkOptions([
      { to: "/dashboard", label: "ダッシュボード" },
      { to: "/reports", label: "レポート" },
    ]),
  },
  {
    to: "/contacts",
    label: "オーディエンス",
    icon: UsersRound,
    tabs: linkOptions([
      { to: "/contacts", label: "連絡先" },
      { to: "/companies", label: "会社" },
      { to: "/lists", label: "リスト" },
      { to: "/segments", label: "セグメント" },
      { to: "/tags", label: "タグ" },
    ]),
  },
  {
    to: "/automations",
    label: "オートメーション",
    icon: Spline,
    tabs: linkOptions([
      { to: "/projects", label: "施策" },
      { to: "/automations", label: "フロー" },
    ]),
  },
  {
    to: "/emails",
    label: "メール",
    icon: Mail,
    tabs: linkOptions([
      { to: "/emails/templates", label: "テンプレート" },
      { to: "/emails/variables", label: "メッセージ変数" },
      { to: "/emails/tracking", label: "計測" },
      { to: "/emails/archive", label: "アーカイブ" },
    ]),
  },
  {
    to: "/scoring",
    label: "スコアリング",
    icon: Target,
    tabs: linkOptions([
      { to: "/scoring/rules", label: "ルール" },
      { to: "/scoring/grading", label: "グレード・カテゴリ" },
    ]),
  },
  {
    to: "/website",
    label: "Website",
    icon: Globe,
    tabs: linkOptions([
      { to: "/website/forms", label: "フォーム" },
      { to: "/website/pages", label: "ランディングページ" },
      { to: "/website/assets", label: "アセット" },
      { to: "/website/messages", label: "サイトメッセージ" },
      { to: "/website/redirects", label: "計測用リンク" },
      { to: "/website/tracking", label: "サイトトラッキング" },
    ]),
  },
  {
    to: "/deals",
    label: "セール",
    icon: BriefcaseBusiness,
    tabs: linkOptions([
      { to: "/deals", label: "パイプライン" },
      { to: "/deal-reports", label: "レポート" },
      { to: "/tasks", label: "タスク" },
    ]),
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

/** The section owning `pathname`, picked by longest matching section or tab path. */
export function activeSection(pathname: string): NavSection | undefined {
  let best: NavSection | undefined;
  let bestLength = 0;
  for (const section of allSections) {
    for (const path of [section.to, ...section.tabs.map((tab) => tab.to)]) {
      if (matches(pathname, path) && path.length > bestLength) {
        best = section;
        bestLength = path.length;
      }
    }
  }
  return best;
}

/**
 * Whether `tab` should only highlight on an exact URL match — true when another
 * tab in the same section lives underneath it.
 */
function isTabExact(section: NavSection, tab: NavLink): boolean {
  return section.tabs.some((other) => other.to !== tab.to && other.to.startsWith(`${tab.to}/`));
}

/** Whether `tab` is the current nested sidebar item for `pathname`. */
export function isNavTabActive(pathname: string, section: NavSection, tab: NavLink): boolean {
  return isTabExact(section, tab) ? pathname === tab.to : matches(pathname, tab.to);
}
