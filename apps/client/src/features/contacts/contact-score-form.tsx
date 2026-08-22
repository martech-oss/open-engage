import { Zap } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { FormInput, LoadingButton } from "@/components/app-ui";
import { FieldGroup } from "@/components/ui/field";
import { getFormString } from "@/lib/form-data";

import { Section } from "./contact-bits";

export function ContactScoreForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (input: { delta: number; reason: string }) => Promise<boolean>;
}): ReactNode {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void onSave({ delta: Number(form.get("delta")), reason: getFormString(form, "reason") }).then(
      (saved) => {
        if (saved) formElement.reset();
      },
    );
  }
  return (
    <Section title="スコアを調整" icon={<Zap className="size-4" />}>
      <form onSubmit={submit}>
        <FieldGroup className="grid gap-3 md:grid-cols-[120px_1fr_auto]">
          <FormInput label="加減点" name="delta" type="number" required />
          <FormInput label="理由" name="reason" required />
          <div className="flex items-end">
            <LoadingButton busy={busy} variant="outline" type="submit">
              反映
            </LoadingButton>
          </div>
        </FieldGroup>
      </form>
    </Section>
  );
}
