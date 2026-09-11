import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { VariableDefinition } from "@openengage/core/projects";

export function CloneVariableInput({ definition }: { definition: VariableDefinition }) {
  const { toDateTimeLocal } = useWorkspaceFormatters();
  return (
    <Field>
      <FieldLabel htmlFor={`clone-variable-${definition.key}`}>
        {definition.key}（{definition.type}）
      </FieldLabel>
      {definition.type === "boolean" ? (
        <NativeSelect
          id={`clone-variable-${definition.key}`}
          name={`variable:${definition.key}`}
          defaultValue={String(definition.value)}
        >
          <NativeSelectOption value="true">はい</NativeSelectOption>
          <NativeSelectOption value="false">いいえ</NativeSelectOption>
        </NativeSelect>
      ) : (
        <Input
          id={`clone-variable-${definition.key}`}
          name={`variable:${definition.key}`}
          type={
            definition.type === "datetime"
              ? "datetime-local"
              : definition.type === "number"
                ? "number"
                : definition.type === "url"
                  ? "url"
                  : "text"
          }
          step={definition.type === "number" ? "any" : undefined}
          defaultValue={
            definition.type === "datetime"
              ? toDateTimeLocal(String(definition.value))
              : String(definition.value)
          }
        />
      )}
    </Field>
  );
}
