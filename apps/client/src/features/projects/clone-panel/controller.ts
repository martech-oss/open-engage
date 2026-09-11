import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";
import type {
  ProjectCloneJob,
  ProjectCloneCursor,
  ProjectCloneOptions,
  ProjectCloneSummary,
} from "@openengage/core/projects";

import {
  projectCloneListQueryOptions,
  projectCloneProgressQueryOptions,
  usePreviewProjectClone,
  useRetryProjectClone,
  useStartProjectClone,
} from "../clone-api";
import { projectBriefOptionsQueryOptions } from "../project-brief-api";
import { variablesQueryOptions } from "../variable-api";

export function useProjectCloneController(projectId: string) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState({
    projectId,
    cursors: [undefined] as Array<ProjectCloneCursor | undefined>,
  });
  const cursors = history.projectId === projectId ? history.cursors : [undefined];
  const setCursors = (
    update: (
      previous: Array<ProjectCloneCursor | undefined>,
    ) => Array<ProjectCloneCursor | undefined>,
  ) => setHistory({ projectId, cursors: update(cursors) });
  const list = useQuery(projectCloneListQueryOptions(projectId, cursors.at(-1)));
  return {
    open,
    setOpen,
    list,
    hasPrevious: cursors.length > 1,
    previousPage: () => setCursors((previous) => previous.slice(0, -1)),
    nextPage: () => {
      const next = list.data?.nextCursor;
      if (next) setCursors((previous) => [...previous, next]);
    },
  };
}

export function useCloneJobController(job: ProjectCloneSummary) {
  const retry = useRetryProjectClone();
  return {
    error: retry.error,
    pending: retry.isPending,
    retry: () => retry.mutate({ id: job.sourceProjectId, jobId: job.id }),
  };
}

export function useProjectCloneDialogController(projectId: string) {
  const { data: options } = useQuery(projectBriefOptionsQueryOptions());
  const { data: variables } = useQuery(variablesQueryOptions(projectId));
  const preview = usePreviewProjectClone(),
    start = useStartProjectClone();
  const [selected, setSelected] = useState<ProjectCloneJob | null>(null);
  const [error, setError] = useState("");
  const { fromDateTimeLocal, toDateTimeLocal } = useWorkspaceFormatters();
  const { timeZone } = useWorkspaceTime();
  const current = useQuery(projectCloneProgressQueryOptions(projectId, selected?.id ?? ""));
  // Keep the frozen preview details locally; polling supplies only mutable summary fields.
  const job = selected
    ? { ...selected, ...current.data, name: current.data?.name ?? selected.options.name }
    : null;

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const overrides: ProjectCloneOptions["variables"] = {};
      for (const definition of variables?.effective.values ?? []) {
        const raw = getFormString(form, `variable:${definition.key}`);
        // An unchanged local display must retain the exact instant, including
        // sub-minute precision and the second occurrence of a repeated DST hour.
        if (
          definition.type === "datetime" &&
          typeof definition.value === "string" &&
          raw === toDateTimeLocal(definition.value)
        )
          continue;
        const value =
          definition.type === "number"
            ? Number(raw)
            : definition.type === "boolean"
              ? raw === "true"
              : definition.type === "datetime"
                ? fromDateTimeLocal(raw)
                : raw;
        if (value !== definition.value) overrides[definition.key] = value;
      }
      const review = getFormString(form, "reviewAt");
      const result = await preview.mutateAsync({
        id: projectId,
        options: {
          name: getFormString(form, "name"),
          ownerUserId: getFormString(form, "ownerUserId") || null,
          approverUserId: getFormString(form, "approverUserId") || null,
          reviewAt: review ? fromDateTimeLocal(review) : null,
          variables: overrides,
        },
      });
      setSelected(result);
    } catch (cause) {
      setError(getErrorMessage(cause, "複製内容を確認できませんでした"));
    }
  }
  async function begin() {
    if (!job) return;
    setError("");
    try {
      setSelected(await start.mutateAsync({ id: projectId, jobId: job.id, requestKey: job.id }));
    } catch (cause) {
      setError(getErrorMessage(cause, "複製を開始できませんでした"));
    }
  }
  return {
    options,
    variables,
    job,
    error,
    timeZone,
    prepare,
    begin,
    previewPending: preview.isPending,
    startPending: start.isPending,
    editSettings: () => setSelected(null),
  };
}
