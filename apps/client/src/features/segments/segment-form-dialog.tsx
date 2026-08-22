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
import { workspaceDateTimeToUtc } from "@openengage/core/shared";

import { useCreateSegment, usePreviewSegment, useUpdateSegment } from "./segment-api";
import { audienceGroupLabel } from "./segment-bits";
import { createDefaultSegmentFilter, mapSegmentDateValues } from "./segment-builder-model";
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
  const { renderedAt, timeZone } = useWorkspaceTime();
  const { toDateTimeLocal } = useWorkspaceFormatters();
  const defaults = { dateTimeLocal: toDateTimeLocal(renderedAt) };
  const [filter, setFilter] = useState<SegmentFilter | null>(() =>
    kind === "dynamic"
      ? initial?.filterAst && catalog
        ? mapSegmentDateValues(initial.filterAst, catalog, toDateTimeLocal)
        : catalog
          ? createDefaultSegmentFilter(catalog, defaults)
          : null
      : null,
  );
  const { previewError, setPreviewError } = useDebouncedSegmentPreview({
    catalog,
    filter,
    kind,
    open,
    preview: previewSegmentFilter,
    timeZone,
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = getFormString(form, "name");
    const description = getFormString(form, "description");
    const membershipSource = getFormString(form, "membershipSource") || "手動選定";
    await run(async () => {
      const persistedFilter =
        kind === "dynamic" && filter && catalog
          ? persistedSegmentFilter(filter, catalog, timeZone)
          : null;
      if (initial) {
        await updateSegment.mutateAsync({
          id: initial.id,
          name,
          slug: initial.slug,
          description,
          kind,
          filter: persistedFilter,
          membershipSource: kind === "static" ? membershipSource : null,
        });
      } else {
        const created = await createSegment.mutateAsync({
          name,
          description,
          kind,
          ...(persistedFilter ? { filter: persistedFilter } : {}),
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
          onPreview={() =>
            void runSegmentPreview(
              persistedSegmentFilter(filter, catalog, timeZone),
              previewSegmentFilter,
              setPreviewError,
            )
          }
        />
      ) : null}
    </FormDialog>
  );
}

function useDebouncedSegmentPreview({
  catalog,
  filter,
  kind,
  open,
  preview,
  timeZone,
}: {
  catalog: SegmentGenerationCatalog | undefined;
  filter: SegmentFilter | null;
  kind: "static" | "dynamic";
  open: boolean;
  preview: (input: { filter: SegmentFilter }) => Promise<unknown>;
  timeZone: string;
}) {
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    if (!open || kind !== "dynamic" || !filter || !catalog) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => preview({ filter: persistedSegmentFilter(filter, catalog, timeZone) }))
        .then(() => {
          if (active) setPreviewError("");
        })
        .catch((cause: unknown) => {
          if (active) setPreviewError(getErrorMessage(cause, "条件をプレビューできませんでした"));
        });
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [catalog, filter, kind, open, preview, timeZone]);
  return { previewError, setPreviewError };
}

function persistedSegmentFilter(
  filter: SegmentFilter,
  catalog: SegmentGenerationCatalog,
  timeZone: string,
): SegmentFilter {
  return mapSegmentDateValues(filter, catalog, (value) => workspaceDateTimeToUtc(value, timeZone));
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
