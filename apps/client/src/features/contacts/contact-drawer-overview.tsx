import { Building2, Filter, Tag, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { ContactProfile } from "@openengage/core/contacts";

import { StatCard } from "./contact-bits";

export function ContactDrawerOverview({ profile }: { profile: ContactProfile }): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  const labels = {
    lead: "見込み客",
    mql: "MQL（営業引き渡し）",
    sql: "SQL（商談化）",
    customer: "顧客（受注）",
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border p-3 text-sm">
        <span>
          営業進捗：<strong>{labels[profile.contact.lifecycleStage ?? "lead"]}</strong>
        </span>
        <span>担当者：{profile.owner?.name ?? "未割り当て"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="スコア" value={profile.contact.score} icon={<Zap />} />
        <StatCard label="タグ" value={profile.tags.length} icon={<Tag />} />
        <StatCard label="所属" value={profile.segments.length} icon={<Filter />} />
        <StatCard label="会社" value={profile.companies.length} icon={<Building2 />} />
      </div>
      {profile.lifecycleHistory?.length ? (
        <ol className="space-y-1 text-xs text-muted-foreground" aria-label="営業進捗の履歴">
          {profile.lifecycleHistory.map((entry) => (
            <li key={entry.stage}>
              {labels[entry.stage]} · {formatDateTime(entry.reachedAt)}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
