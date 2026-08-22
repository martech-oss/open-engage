import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { FormDialog } from "@/components/app-ui/dialogs";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";
import type {
  SegmentFilter,
  SegmentGenerationCatalog,
  SegmentRow,
} from "@openengage/core/segments";

import { useCreateSegment, usePreviewSegment, useUpdateSegment } from "./segment-api";
import { audienceGroupLabel } from "./segment-bits";
import { createDefaultSegmentFilter } from "./segment-builder-model";
import {
  DynamicSegmentFields,
  SegmentIdentityFields,
  StaticSegmentFields,
} from "./segment-form-fields";

export function SegmentFormDialog({
  open,
  onOpenChange,
  initial,
  catalog,
  kind,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: SegmentRow | null;
  catalog?: SegmentGenerationCatalog;
  kind: "static" | "dynamic";
  onCreated?: (id: string) => void;
}): ReactNode {
  const createSegment = useCreateSegment();
  const updateSegment = useUpdateSegment();
  const previewSegment = usePreviewSegment();
  const { mutateAsync: previewSegmentFilter } = previewSegment;
  const label = audienceGroupLabel(kind);
  const { busy, error, run } = useFormSubmission(`${label}を保存できませんでした`);
  const { renderedAt } = useWorkspaceTime();
  const { toDateTimeLocal } = useWorkspaceFormatters();
  const defaults = { dateTimeLocal: toDateTimeLocal(renderedAt) };
  const [filter, setFilter] = useState<SegmentFilter | null>(() =>
    kind === "dynamic"
      ? (initial?.filterAst ?? (catalog ? createDefaultSegmentFilter(catalog, defaults) : null))
      : null,
  );
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!open || kind !== "dynamic" || !filter) return;
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
    const membershipSource = getFormString(form, "membershipSource") || "手動選定";
    await run(async () => {
      if (initial) {
        await updateSegment.mutateAsync({
          id: initial.id,
          name,
          slug: initial.slug,
          description,
          kind,
          filter: kind === "dynamic" && filter ? filter : null,
          membershipSource: kind === "static" ? membershipSource : null,
        });
      } else {
        const created = await createSegment.mutateAsync({
          name,
          description,
          kind,
          ...(kind === "dynamic" && filter ? { filter } : {}),
          membershipSource: kind === "static" ? membershipSource : null,
        });
        onCreated?.(created.id);
      }
      onOpenChange(false);
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? `${label}を編集` : `${label}を作成`}
      description={
        kind === "static"
          ? "手動でメンバーを出し入れする連絡先の集まりです。"
          : "複数の属性・行動・同意条件を組み合わせて対象者を定義します。"
      }
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={initial ? "更新" : "作成"}
      {...(kind === "dynamic" ? { className: "sm:max-w-4xl" } : {})}
    >
      <SegmentIdentityFields initial={initial} />
      {kind === "static" ? (
        <StaticSegmentFields initial={initial} />
      ) : catalog && filter ? (
        <DynamicSegmentFields
          catalog={catalog}
          filter={filter}
          defaults={defaults}
          previewPending={previewSegment.isPending}
          previewData={previewSegment.data}
          previewError={previewError}
          onFilterChange={setFilter}
          onPreview={() => void runSegmentPreview(filter, previewSegmentFilter, setPreviewError)}
        />
      ) : null}
    </FormDialog>
  );
}

async function runSegmentPreview(
  filter: SegmentFilter,
  preview: (input: { filter: SegmentFilter }) => Promise<unknown>,
  setError: (message: string) => void,
): Promise<void> {
  setError("");
  try {
    await preview({ filter });
  } catch (cause) {
    setError(getErrorMessage(cause, "条件をプレビューできませんでした"));
  }
}
