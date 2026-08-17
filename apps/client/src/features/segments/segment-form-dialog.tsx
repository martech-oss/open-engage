import { RefreshCw } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import {
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  LoadingButton,
} from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { slugify } from "@/lib/utils";
import type {
  SegmentFilter,
  SegmentGenerationCatalog,
  SegmentRow,
} from "@openengage/core/segments";

import { useCreateSegment, usePreviewSegment, useUpdateSegment } from "./segment-api";
import { defaultSegmentFilter, SegmentBuilder } from "./segment-builder";

export function SegmentFormDialog({
  open,
  onOpenChange,
  initial,
  catalog,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: SegmentRow | null;
  catalog: SegmentGenerationCatalog;
  onCreated?: (id: string) => void;
}): ReactNode {
  const createSegment = useCreateSegment();
  const updateSegment = useUpdateSegment();
  const previewSegment = usePreviewSegment();
  const { mutateAsync: previewSegmentFilter } = previewSegment;
  const { busy, error, run } = useFormSubmission("セグメントを保存できませんでした");
  const [kind, setKind] = useState<"static" | "dynamic">(initial?.kind ?? "dynamic");
  const [filter, setFilter] = useState<SegmentFilter>(
    initial?.filterAst ?? defaultSegmentFilter(catalog),
  );
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!open || kind !== "dynamic") return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void previewSegmentFilter({ filter })
        .then(() => {
          if (active) setPreviewError("");
        })
        .catch((cause: unknown) => {
          if (active) {
            setPreviewError(getErrorMessage(cause, "条件をプレビューできませんでした"));
          }
        });
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [filter, kind, open, previewSegmentFilter]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = getFormString(form, "name");
    const description = getFormString(form, "description");
    const membershipSource = getFormString(form, "membershipSource") || "Manual selection";
    await run(async () => {
      if (initial) {
        await updateSegment.mutateAsync({
          id: initial.id,
          name,
          slug: initial.slug,
          description,
          kind,
          filter: kind === "dynamic" ? filter : null,
          membershipSource: kind === "static" ? membershipSource : null,
        });
      } else {
        const created = await createSegment.mutateAsync({
          name,
          slug: slugify(name),
          description,
          kind,
          ...(kind === "dynamic" ? { filter } : {}),
          membershipSource: kind === "static" ? membershipSource : null,
        });
        onCreated?.(created.id);
      }
      onOpenChange(false);
    });
  }

  async function preview(): Promise<void> {
    setPreviewError("");
    try {
      await previewSegmentFilter({ filter });
    } catch (cause) {
      setPreviewError(getErrorMessage(cause, "条件をプレビューできませんでした"));
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "セグメントを編集" : "セグメントを作成"}
      description="複数の属性・行動・同意条件を組み合わせて対象者を定義します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={initial ? "更新" : "作成"}
      className="sm:max-w-4xl"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FormInput label="名前" name="name" defaultValue={initial?.name} required />
        <FormNativeSelect
          label="種類"
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as "static" | "dynamic")}
        >
          <FormSelectOption value="static">静的（手動メンバー）</FormSelectOption>
          <FormSelectOption value="dynamic">動的（条件で自動更新）</FormSelectOption>
        </FormNativeSelect>
      </div>
      <Field>
        <FieldLabel htmlFor="segment-description">説明</FieldLabel>
        <Input id="segment-description" name="description" defaultValue={initial?.description} />
      </Field>
      {kind === "static" ? (
        <Field>
          <FieldLabel htmlFor="membership-source">メンバーの選定元</FieldLabel>
          <Input
            id="membership-source"
            name="membershipSource"
            defaultValue={initial?.membershipSource ?? "Manual selection"}
            required
          />
          <FieldDescription>作成後、連絡先画面からメンバーを追加・削除できます。</FieldDescription>
        </Field>
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel>オーディエンス条件</FieldLabel>
            <SegmentBuilder value={filter} catalog={catalog} onChange={setFilter} />
          </Field>
          <div className="flex items-center gap-3">
            <LoadingButton
              type="button"
              variant="outline"
              busy={previewSegment.isPending}
              busyLabel="確認中…"
              onClick={() => void preview()}
            >
              <RefreshCw data-icon="inline-start" />
              人数を確認
            </LoadingButton>
            {previewSegment.data ? (
              <strong>{previewSegment.data.matchedCount.toLocaleString()}件</strong>
            ) : null}
          </div>
          {previewError ? (
            <Alert variant="destructive">
              <AlertTitle>条件が無効です</AlertTitle>
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          ) : null}
          {previewSegment.data?.contacts.length ? (
            <ItemGroup>
              {previewSegment.data.contacts.slice(0, 5).map((contact) => (
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
      )}
    </FormDialog>
  );
}
