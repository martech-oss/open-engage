import { FormInput } from "@/components/app-ui/form-fields";
import { VariableProjectField } from "@/features/projects/variable-project-field";

import type { SignupFormRow } from "./website-api";
export function SignupFormVariableFields({
  item,
  optionalFields,
  projectId,
  onProjectChange,
  disabled,
}: {
  item: SignupFormRow | null;
  optionalFields: ReadonlySet<string>;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  disabled: boolean;
}) {
  return (
    <>
      <VariableProjectField value={projectId} onChange={onProjectChange} disabled={disabled} />
      <p className="text-sm text-muted-foreground">
        表示文と完了メッセージで {"{{variables.key}}"} を使用できます。公開時に値を固定します。
      </p>
      {["email", ...optionalFields].map((key) => (
        <FormInput
          key={key}
          name={`label-${key}`}
          label={`${key} の表示ラベル`}
          defaultValue={item?.definition.fields?.find((field) => field.key === key)?.label ?? ""}
          placeholder="{{variables.label}}"
        />
      ))}
    </>
  );
}
