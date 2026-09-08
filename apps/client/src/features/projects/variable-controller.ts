import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useFormSubmission } from "@/hooks/use-form-submission";
import {
  variableWriteSchema,
  type VariableDefinition,
  type VariableImpactInput,
  type VariableType,
} from "@openengage/core/projects";

import {
  variablesQueryOptions,
  variableUsesQueryOptions,
  useSaveVariable,
  useDeleteVariable,
  usePreviewVariableImpact,
} from "./variable-api";

export function useVariableSettings(projectId: string | null) {
  const query = useQuery(variablesQueryOptions(projectId));
  const [editing, setEditing] = useState(false),
    [key, setKey] = useState(""),
    [type, setType] = useState<VariableType>("string"),
    [value, setValue] = useState(""),
    [revision, setRevision] = useState(0),
    [useKey, setUseKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<ReturnType<typeof usePreviewVariableImpact>["mutateAsync"]>
  > | null>(null);
  const [remove, setRemove] = useState(false);
  const uses = useQuery({
    ...variableUsesQueryOptions(projectId, useKey ?? undefined),
    enabled: useKey !== null,
  });
  const save = useSaveVariable(),
    del = useDeleteVariable(),
    impact = usePreviewVariableImpact();
  const { busy, error, run } = useFormSubmission("変数を更新できませんでした");
  const inputId = useId();
  const own = (item: VariableDefinition) =>
    query.data?.definitions.find(
      (definition) => definition.key === item.key && definition.projectId === projectId,
    );
  function edit(item?: VariableDefinition, deleting = false) {
    setEditing(true);
    setKey(item?.key ?? "");
    setType(item?.type ?? "string");
    setValue(String(item?.value ?? ""));
    setRevision(item ? (own(item)?.revision ?? 0) : 0);
    setPreview(null);
    setRemove(deleting);
  }
  function payload() {
    let scalar: string | number | boolean = value;
    if (type === "number") {
      if (!value.trim()) throw new Error("数値を入力してください");
      scalar = Number(value);
    }
    if (type === "boolean") {
      if (!["true", "false"].includes(value))
        throw new Error("true または false を選択してください");
      scalar = value === "true";
    }
    return variableWriteSchema.parse({
      projectId,
      key,
      type,
      value: scalar,
      expectedRevision: revision,
    });
  }
  async function check() {
    await run(async () =>
      setPreview(await impact.mutateAsync({ ...payload(), remove } as VariableImpactInput)),
    );
  }
  async function submit() {
    if (!preview) return;
    await run(async () => {
      const input = payload();
      if (remove) await del.mutateAsync({ projectId, key, expectedRevision: revision });
      else await save.mutateAsync(input);
      setEditing(false);
      setPreview(null);
    });
  }
  return {
    query,
    editing,
    setEditing,
    key,
    setKey,
    type,
    setType,
    value,
    setValue,
    revision,
    useKey,
    setUseKey,
    preview,
    setPreview,
    remove,
    uses,
    busy,
    error,
    inputId,
    own,
    edit,
    check,
    submit,
  };
}
