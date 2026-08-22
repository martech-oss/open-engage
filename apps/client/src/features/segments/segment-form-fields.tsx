import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { FormInput, LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import type {
  SegmentFilter,
  SegmentGenerationCatalog,
  SegmentRow,
} from "@openengage/core/segments";

import { SegmentBuilder } from "./segment-builder";
import type { SegmentDefaultValues } from "./segment-builder-model";

export function SegmentIdentityFields({ initial }: { initial: SegmentRow | null }): ReactNode {
  return (
    <>
      <FormInput label="名前" name="name" defaultValue={initial?.name} required />
      <Field>
        <FieldLabel htmlFor="segment-description">説明</FieldLabel>
        <Input id="segment-description" name="description" defaultValue={initial?.description} />
      </Field>
    </>
  );
}

export function StaticSegmentFields({ initial }: { initial: SegmentRow | null }): ReactNode {
  return (
    <Field>
      <FieldLabel htmlFor="membership-source">メンバーの選定元</FieldLabel>
      <Input
        id="membership-source"
        name="membershipSource"
        defaultValue={initial?.membershipSource ?? "手動選定"}
        required
      />
      <FieldDescription>作成後、この画面からメンバーを追加・削除できます。</FieldDescription>
    </Field>
  );
}

type PreviewData = {
  matchedCount: number;
  contacts: Array<{
    id: string;
    email: string | null;
    externalId: string | null;
    stage: string;
    score: number;
  }>;
};

export function DynamicSegmentFields({
  catalog,
  filter,
  defaults,
  previewPending,
  previewData,
  previewError,
  onFilterChange,
  onPreview,
}: {
  catalog: SegmentGenerationCatalog;
  filter: SegmentFilter;
  defaults: SegmentDefaultValues;
  previewPending: boolean;
  previewData: PreviewData | undefined;
  previewError: string;
  onFilterChange: (filter: SegmentFilter) => void;
  onPreview: () => void;
}): ReactNode {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>オーディエンス条件</FieldLabel>
        <SegmentBuilder
          value={filter}
          catalog={catalog}
          defaults={defaults}
          onChange={onFilterChange}
        />
      </Field>
      <div className="flex items-center gap-3">
        <LoadingButton
          type="button"
          variant="outline"
          busy={previewPending}
          busyLabel="確認中…"
          onClick={onPreview}
        >
          <RefreshCw data-icon="inline-start" />
          人数を確認
        </LoadingButton>
        {previewData ? <strong>{previewData.matchedCount.toLocaleString()}件</strong> : null}
      </div>
      {previewError ? (
        <Alert variant="destructive">
          <AlertTitle>条件が無効です</AlertTitle>
          <AlertDescription>{previewError}</AlertDescription>
        </Alert>
      ) : null}
      {previewData?.contacts.length ? (
        <ItemGroup>
          {previewData.contacts.slice(0, 5).map((contact) => (
            <Item key={contact.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{contact.email ?? contact.externalId ?? contact.id}</ItemTitle>
                <ItemDescription>
                  {contact.stage} · score {contact.score}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : null}
      <Alert>
        <AlertTitle>配信時のガードレール</AlertTitle>
        <AlertDescription>
          グローバル配信停止、bounce・complaint抑止、送信頻度上限はセグメント条件とは別に、送信時に必ず評価されます。
        </AlertDescription>
      </Alert>
    </FieldGroup>
  );
}
