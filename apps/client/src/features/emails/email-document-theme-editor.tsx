import type { ReactNode } from "react";

import { FormInput } from "@/components/app-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EmailTheme } from "@openengage/core/messaging";

export function EmailDocumentThemeEditor({
  theme,
  onChange,
}: {
  theme: EmailTheme;
  onChange: (theme: EmailTheme) => void;
}): ReactNode {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>テーマ</CardTitle>
        <CardDescription>メール本文に保存されるデザイン設定です。</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="sm:grid sm:grid-cols-2">
          <ColorField
            id="email-background-color"
            label="背景色"
            value={theme.backgroundColor}
            onChange={(backgroundColor) => onChange({ ...theme, backgroundColor })}
          />
          <ColorField
            id="email-surface-color"
            label="本文背景色"
            value={theme.surfaceColor}
            onChange={(surfaceColor) => onChange({ ...theme, surfaceColor })}
          />
          <ColorField
            id="email-text-color"
            label="本文色"
            value={theme.textColor}
            onChange={(textColor) => onChange({ ...theme, textColor })}
          />
          <ColorField
            id="email-accent-color"
            label="アクセント色"
            value={theme.accentColor}
            onChange={(accentColor) => onChange({ ...theme, accentColor })}
          />
          <Field>
            <FieldLabel>フォント</FieldLabel>
            <ToggleGroup
              value={[theme.fontFamily]}
              onValueChange={(next) => {
                const fontFamily = next[0] as EmailTheme["fontFamily"] | undefined;
                if (fontFamily) onChange({ ...theme, fontFamily });
              }}
              variant="outline"
              spacing={0}
            >
              <ToggleGroupItem value="sans">Sans</ToggleGroupItem>
              <ToggleGroupItem value="serif">Serif</ToggleGroupItem>
              <ToggleGroupItem value="mono">Mono</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <FormInput
            label="本文幅"
            name="emailWidth"
            type="number"
            min={320}
            max={720}
            value={theme.width}
            onChange={(event) => onChange({ ...theme, width: Number(event.target.value) || 600 })}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="color"
          value={value}
          className="w-14 px-1"
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          value={value}
          pattern="#[0-9A-Fa-f]{6}"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <FieldDescription>HEXカラー</FieldDescription>
    </Field>
  );
}
