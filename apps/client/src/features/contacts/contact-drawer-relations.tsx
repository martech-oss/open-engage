import { Building2, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContactOptions } from "@/features/contacts/contact-api";
import type { ContactProfile } from "@openengage/core/contacts";

import { ControlledSelect, Section } from "./contact-bits";
import { RelationEditor, SegmentEditor } from "./contact-editors";

export function ContactDrawerRelations({
  profile,
  options,
  busy,
  onAssignTag,
  onRemoveTag,
  onAddSegment,
  onRemoveSegment,
  onAddCompany,
  onRemoveCompany,
}: {
  profile: ContactProfile;
  options: ContactOptions;
  busy: boolean;
  onAssignTag: (id: string) => Promise<boolean>;
  onRemoveTag: (id: string) => Promise<boolean>;
  onAddSegment: (id: string) => Promise<boolean>;
  onRemoveSegment: (id: string) => Promise<boolean>;
  onAddCompany: (id: string) => Promise<boolean>;
  onRemoveCompany: (id: string) => Promise<boolean>;
}): ReactNode {
  const disabled = profile.contact.status === "archived";
  return (
    <>
      <RelationEditor
        title="タグ"
        icon={<Tags className="size-4" />}
        items={profile.tags}
        options={options.tags}
        disabled={disabled || busy}
        onAdd={async (id) => {
          await onAssignTag(id);
        }}
        onRemove={async (id) => {
          await onRemoveTag(id);
        }}
      />
      <CompanyRelations
        profile={profile}
        options={options}
        disabled={disabled || busy}
        onAdd={onAddCompany}
        onRemove={onRemoveCompany}
      />
      <SegmentEditor
        profile={profile}
        options={options.segments}
        disabled={disabled || busy}
        onAdd={async (id) => {
          await onAddSegment(id);
        }}
        onRemove={async (id) => {
          await onRemoveSegment(id);
        }}
      />
    </>
  );
}

function CompanyRelations({
  profile,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  profile: ContactProfile;
  options: ContactOptions;
  disabled: boolean;
  onAdd: (id: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(profile.companies.map((company) => company.id));
  return (
    <Section title="会社" icon={<Building2 />}>
      <div className="flex flex-wrap gap-2">
        {profile.companies.map((company) => (
          <Badge key={company.id} variant="outline">
            <Building2 />
            {company.name}
            {company.isPrimary ? " · 主担当" : ""}
            {!disabled ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void onRemove(company.id)}
                aria-label={`${company.name}との関連を解除`}
              >
                ×
              </Button>
            ) : null}
          </Badge>
        ))}
        {profile.companies.length === 0 ? (
          <span className="text-sm text-muted-foreground">未所属</span>
        ) : null}
      </div>
      {!disabled ? (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="追加する会社を選択"
            className="flex-1"
            options={options.companies
              .filter((company) => !assigned.has(company.id))
              .map((company) => ({ value: company.id, label: company.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then((saved) => {
                if (saved) setSelectedId("");
              });
            }}
          >
            追加
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
