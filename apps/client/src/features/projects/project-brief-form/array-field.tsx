import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { errorAt, type ProjectBriefFieldErrors } from "./draft";

export function ArrayField({
  name,
  label,
  value,
  disabled,
  errors,
  minItems = 0,
  maxItems = 100,
  onChange,
}: {
  name: string;
  label: string;
  value: string[];
  disabled: boolean;
  errors: ProjectBriefFieldErrors;
  minItems?: number;
  maxItems?: number;
  onChange: (value: string[]) => void;
}): ReactNode {
  const groupError = errorAt(errors, name);
  return (
    <Field data-invalid={Boolean(groupError)} data-disabled={disabled}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>{label}</FieldLabel>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || value.length >= maxItems}
          onClick={() => onChange([...value, ""])}
        >
          <Plus data-icon="inline-start" />
          追加
        </Button>
      </div>
      {value.length ? (
        <div className="space-y-2">
          {value.map((item, index) => {
            const itemError = errors[`${name}.${index}`];
            return (
              <div key={`${name}-${index}`} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`${label} ${index + 1}`}
                    aria-invalid={Boolean(itemError)}
                    value={item}
                    disabled={disabled}
                    maxLength={500}
                    onChange={(event) =>
                      onChange(
                        value.map((entry, itemIndex) =>
                          itemIndex === index ? event.target.value : entry,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${label} ${index + 1}を上へ移動`}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(move(value, index, index - 1))}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${label} ${index + 1}を下へ移動`}
                    disabled={disabled || index === value.length - 1}
                    onClick={() => onChange(move(value, index, index + 1))}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${label} ${index + 1}を削除`}
                    disabled={disabled || value.length <= minItems}
                    onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {itemError ? <FieldError>{itemError}</FieldError> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">項目はありません</p>
      )}
      {groupError && !Object.keys(errors).some((key) => key.startsWith(`${name}.`)) ? (
        <FieldError>{groupError}</FieldError>
      ) : null}
    </Field>
  );
}

function move(items: string[], from: number, to: number): string[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}
