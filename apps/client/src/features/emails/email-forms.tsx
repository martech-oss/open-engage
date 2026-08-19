import { Sparkles } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormInput, FormTextarea } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type EmailTemplateRow,
  type MessageVariableRow,
  useCreateEmailTemplate,
  useCreateEmailVariable,
  usePreviewEmailTemplate,
  useUpdateEmailTemplate,
  useUpdateEmailVariable,
} from "@/features/emails/email-api";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import {
  defaultEmailDocumentV2,
  type EmailDocumentV2,
  type EmailGenerationProposal,
  type EmailPurpose,
} from "@openengage/core/messaging";

import { EmailAiSheet } from "./email-ai-sheet";
import { EmailDocumentEditor } from "./email-document-editor";

export function TemplateForm({
  open,
  onOpenChange,
  template,
  onSaved,
  initialAiOpen = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: EmailTemplateRow | null;
  onSaved: () => void;
  initialAiOpen?: boolean;
}): ReactNode {
  const createTemplate = useCreateEmailTemplate();
  const updateTemplate = useUpdateEmailTemplate();
  const previewTemplate = usePreviewEmailTemplate();
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [purpose, setPurpose] = useState<EmailPurpose>(template?.purpose ?? "transactional");
  const [content, setContent] = useState<EmailDocumentV2>(
    template?.content ?? defaultEmailDocumentV2(),
  );
  const [aiOpen, setAiOpen] = useState(initialAiOpen);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(
    null,
  );
  const { busy, error, run } = useFormSubmission("テンプレートを保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await run(async () => {
      if (template) {
        await updateTemplate.mutateAsync({ id: template.id, name, subject, content });
        toast.success("テンプレートを更新しました");
      } else {
        await createTemplate.mutateAsync({ name, purpose, subject, content });
        toast.success("テンプレートを作成しました");
      }
      onSaved();
    });
  }

  const currentProposal: EmailGenerationProposal = { name, subject, content };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "メールテンプレートを編集" : "メールテンプレートを作成"}
      description="構造化された下書きからReact Emailが安全なHTMLとplain textを生成します。"
      className="sm:max-w-3xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={template ? "下書きを保存" : "テンプレートを作成"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3">
        <div>
          <p className="text-sm font-medium">AIメールデザイナー</p>
          <p className="text-sm text-muted-foreground">
            提案を確認してから、この下書きへ反映します。
          </p>
        </div>
        <Button type="button" onClick={() => setAiOpen(true)}>
          <Sparkles data-icon="inline-start" />
          {template ? "AIで改善" : "AIで作成"}
        </Button>
      </div>
      <Field data-disabled={Boolean(template)}>
        <FieldLabel>用途</FieldLabel>
        <ToggleGroup
          value={[purpose]}
          disabled={Boolean(template)}
          onValueChange={(next) => {
            const selected = next[0] as EmailPurpose | undefined;
            if (selected) setPurpose(selected);
          }}
          variant="outline"
          spacing={0}
        >
          <ToggleGroupItem value="transactional">Transactional</ToggleGroupItem>
          <ToggleGroupItem value="marketing">Marketing</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {purpose === "marketing"
            ? "作成・プレビュー・公開に対応しています。実送信とAutomation利用はまだ無効です。"
            : "公開後にAutomationから送信できます。用途は作成後に変更できません。"}
        </FieldDescription>
      </Field>
      <FormInput
        label="管理名"
        name="name"
        value={name}
        placeholder="申込確認"
        onChange={(event) => setName(event.target.value)}
        required
      />
      <FormInput
        label="件名"
        name="subject"
        value={subject}
        placeholder="{{ contact.first_name }}さん、お申し込みありがとうございます"
        maxLength={998}
        onChange={(event) => setSubject(event.target.value)}
        required
      />
      <EmailDocumentEditor value={content} onChange={setContent} />
      <Button
        type="button"
        variant="outline"
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          void previewTemplate
            .mutateAsync({ purpose, subject, content })
            .then(setPreview)
            .catch((caught: unknown) =>
              toast.error(getErrorMessage(caught, "プレビューを生成できませんでした")),
            );
        }}
      >
        プレビューを生成
      </Button>
      {preview ? (
        <div className="grid gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">{preview.subject}</p>
          <iframe
            title="メールHTMLプレビュー"
            srcDoc={preview.html}
            sandbox=""
            className="h-72 w-full rounded border"
          />
          <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">{preview.text}</pre>
        </div>
      ) : null}
      <EmailAiSheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        entityId={template?.id}
        mode={template ? "refine" : "create"}
        purpose={purpose}
        current={currentProposal}
        onApply={(proposal) => {
          setName(proposal.name);
          setSubject(proposal.subject);
          setContent(proposal.content);
          setPreview(null);
        }}
      />
    </FormDialog>
  );
}

export function VariableForm({
  open,
  onOpenChange,
  variable,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variable: MessageVariableRow | null;
  onSaved: () => void;
}): ReactNode {
  const createVariable = useCreateEmailVariable();
  const updateVariable = useUpdateEmailVariable();
  const { busy, error, run } = useFormSubmission("メッセージ変数を保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      key: getFormString(form, "key"),
      name: getFormString(form, "name"),
      value: getFormString(form, "value"),
      description: getFormString(form, "description"),
    };
    await run(() =>
      saveResource({
        editing: variable,
        payload,
        create: (data) => createVariable.mutateAsync(data),
        update: (id, data) => updateVariable.mutateAsync({ id, ...data }),
        createdMessage: "メッセージ変数を作成しました",
        updatedMessage: "メッセージ変数を更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={variable ? "メッセージ変数を編集" : "メッセージ変数を作成"}
      description="テンプレート内では {{ message.key }} の形式で利用します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={variable ? "変更を保存" : "変数を作成"}
    >
      <FormInput
        label="表示名"
        name="name"
        defaultValue={variable?.name}
        placeholder="ブランド名"
        required
      />
      <FormInput
        label="キー"
        name="key"
        defaultValue={variable?.key}
        placeholder="brand_name"
        pattern="[a-z][a-z0-9_]*"
        description="英小文字で始まり、英小文字・数字・_のみ使用できます。"
        required
      />
      <FormTextarea label="値" name="value" defaultValue={variable?.value} rows={5} required />
      <FormTextarea label="説明" name="description" defaultValue={variable?.description} rows={2} />
    </FormDialog>
  );
}
