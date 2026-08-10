import { linkOptions } from "@tanstack/react-router";
import { BriefcaseBusiness, Gauge, Globe, Mail, Settings, Spline, UsersRound } from "lucide-react";

export interface NavLink {
  to: string;
  label: string;
}

export interface NavSection extends NavLink {
  icon: typeof Gauge;
  /** Sub-navigation rendered as tabs in the page header, empty for leaf sections. */
  tabs: readonly NavLink[];
}

/**
 * The sidebar's six sections plus 設定, each owning the sub-navigation that used
 * to be a nested sidebar menu and is now a tab row in the page header.
 *
 * Single source of truth: the sidebar reads the sections, `PageLayout` reads the
 * tabs of whichever section {@link activeSection} resolves for the current URL.
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
      { to: "/contacts/companies", label: "会社" },
      { to: "/contacts/segments", label: "セグメント" },
      { to: "/contacts/tags", label: "タグ" },
    ]),
  },
  {
    to: "/automations",
    label: "オートメーション",
    icon: Spline,
    tabs: linkOptions([
      { to: "/automations/briefs", label: "施策ブリーフ" },
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
      { to: "/emails/archive", label: "アーカイブ" },
    ]),
  },
  {
    to: "/website",
    label: "Website",
    icon: Globe,
    tabs: linkOptions([
      { to: "/website/forms", label: "サインアップフォーム" },
      { to: "/website/pages", label: "ランディングページ" },
      { to: "/website/assets", label: "アセット" },
      { to: "/website/messages", label: "サイトメッセージ" },
      { to: "/website/tracking", label: "サイトトラッキング" },
    ]),
  },
  { to: "/deals", label: "Deals", icon: BriefcaseBusiness, tabs: [] },
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
 * tab in the same row lives underneath it, as 会社/セグメント/タグ do under 連絡先.
 */
export function isTabExact(section: NavSection, tab: NavLink): boolean {
  return section.tabs.some((other) => other.to !== tab.to && other.to.startsWith(`${tab.to}/`));
}
