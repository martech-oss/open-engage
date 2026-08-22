import { Zap } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { ContactProfile } from "@openengage/core/contacts";

import { Section } from "./contact-bits";
import { buildContactTimeline } from "./contact-timeline-model";

export function ContactTimelineTab({ profile }: { profile: ContactProfile }): ReactNode {
  const { formatLongDateTime } = useWorkspaceFormatters();
  const entries = buildContactTimeline(profile);
  return (
    <Section title="アクティビティ" icon={<Zap className="size-4" />}>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <div key={`${entry.type}-${entry.id}`} className="flex gap-3 border-b py-3 last:border-0">
            <span
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                entry.tone === "emerald"
                  ? "bg-success"
                  : entry.tone === "amber"
                    ? "bg-warning"
                    : "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{entry.type}</div>
              <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
            </div>
            <time className="shrink-0 text-xs text-muted-foreground">
              {formatLongDateTime(entry.at)}
            </time>
          </div>
        ))}
        {entries.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            まだアクティビティがありません
          </div>
        ) : null}
      </div>
    </Section>
  );
}
