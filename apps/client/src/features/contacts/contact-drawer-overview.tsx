import { Building2, Filter, Tag, Zap } from "lucide-react";
import type { ReactNode } from "react";

import type { ContactProfile } from "@openengage/core/contacts";

import { StatCard } from "./contact-bits";

export function ContactDrawerOverview({ profile }: { profile: ContactProfile }): ReactNode {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="スコア" value={profile.contact.score} icon={<Zap />} />
      <StatCard label="タグ" value={profile.tags.length} icon={<Tag />} />
      <StatCard label="所属" value={profile.segments.length} icon={<Filter />} />
      <StatCard label="会社" value={profile.companies.length} icon={<Building2 />} />
    </div>
  );
}
