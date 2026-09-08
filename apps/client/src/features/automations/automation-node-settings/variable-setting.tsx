import type { VariableRef, VariableType } from "@openengage/core/projects";

import { DateTimeSetting } from "./datetime-setting";
import { SettingInput, SettingSelect } from "./fields";
type Value<T extends VariableType> =
  | (T extends "number" ? number : T extends "boolean" ? boolean : string)
  | (VariableRef & { type: T });
export function VariableSetting<T extends VariableType>({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: T;
  value: Value<T>;
  onChange: (value: Value<T>) => void;
}) {
  const reference = typeof value === "object";
  return (
    <>
      <SettingSelect
        label={`${label}の指定方法`}
        value={reference ? "variable" : "literal"}
        options={[
          ["literal", "値を入力"],
          ["variable", "共通変数を使用"],
        ]}
        onChange={(mode) =>
          onChange(
            (mode === "variable"
              ? { kind: "variable", type, key: "value" }
              : type === "number"
                ? 0
                : type === "boolean"
                  ? false
                  : "") as Value<T>,
          )
        }
      />
      {reference ? (
        <SettingInput
          label={`${label}の変数キー`}
          value={value.key}
          onChange={(key) => onChange({ ...value, key })}
        />
      ) : type === "datetime" ? (
        <DateTimeSetting
          label={label}
          value={String(value)}
          onChange={(next) => onChange(next as Value<T>)}
        />
      ) : (
        <SettingInput
          label={label}
          type={type === "number" ? "number" : "text"}
          value={String(value)}
          onChange={(next) =>
            onChange(
              (type === "number"
                ? Number(next)
                : type === "boolean"
                  ? next === "true"
                  : next) as Value<T>,
            )
          }
        />
      )}
    </>
  );
}
