import { useSuspenseQuery } from "@tanstack/react-query";
import { Code2, ExternalLink, Pencil, Rows3 } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ArchiveConfirm,
  CopyButton,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
  MetricCard,
  MetricGrid,
} from "@/components/app-ui";
import { type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { FormFieldBuilder } from "@/features/website/form-field-builder";
import { WebsiteResourceListPage } from "@/features/website/resource-page";
import {
  signupFormsQueryOptions,
  type SignupFormDefinition,
  type SignupFormRow,
  useArchiveSignupForm,
  useCreateSignupForm,
  useUpdateSignupForm,
} from "@/features/website/website-api";
import { PublishStatusBadge } from "@/features/website/website-shared";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { useResourceEditor } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { FormField } from "@openengage/core/web";

export function SignupFormsPage({ workspaceSlug }: { workspaceSlug: string }): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  const { data: items } = useSuspenseQuery(signupFormsQueryOptions());
  const { dialogOpen, editing, openCreate, openEdit, close, onOpenChange } =
    useResourceEditor<SignupFormRow>();

  const archiveForm = useArchiveSignupForm();

  async function archive(item: SignupFormRow): Promise<void> {
    try {
      await archiveForm.mutateAsync({ id: item.id });
      toast.success("サインアップフォームをアーカイブしました");
    } catch (error) {
      toast.error(getErrorMessage(error, "アーカイブできませんでした"));
    }
  }

  const columns: DataTableColumn<SignupFormRow>[] = [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            /{item.slug} · v{item.version}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "状態",
      cell: (item) => <PublishStatusBadge status={item.status} />,
    },
    {
      key: "style",
      header: "形式",
      cell: (item) => formStyleLabel(item.definition.style),
    },
    {
      key: "submissions",
      header: "送信",
      cell: (item) => item.submissionCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    {
      key: "updatedAt",
      header: "更新日時",
      cell: (item) => formatDateTime(item.updatedAt),
    },
    {
      key: "actions",
      header: "操作",
      cell: (item) => {
        const publicUrl = `${window.location.origin}/f/${workspaceSlug}/${item.slug}`;
        const embedCode = `<script async src="${window.location.origin}/api/public/forms/${workspaceSlug}/${item.slug}/embed.js"></script>`;
        return (
          <div className="flex justify-end gap-1">
            <CopyButton value={embedCode} label="埋め込み" />
            {item.status === "published" ? (
              <Button
                size="sm"
                variant="outline"
                render={
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${item.name}を表示`}
                  />
                }
              >
                <ExternalLink data-icon="inline-start" />
                表示
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${item.name}を編集`}
              onClick={() => openEdit(item)}
            >
              <Pencil />
            </Button>
            <ArchiveConfirm
              label={item.name}
              description={`「${item.name}」は公開を終了し、通常の一覧から非表示になります。`}
              onConfirm={() => archive(item)}
            />
          </div>
        );
      },
      headClassName: "text-right",
    },
  ];

  return (
    <WebsiteResourceListPage
      title="フォーム"
      createLabel="フォームを作成"
      onCreateClick={openCreate}
      summary={<FormSummary items={items} />}
      listTitle="フォーム一覧"
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      tableCaption="フォーム一覧"
      emptyTitle="サインアップフォームがありません"
      emptyDescription="最初のフォームを作成すると、公開URLから連絡先を獲得できます。"
      editor={
        <SignupFormEditor
          key={editing?.id ?? "new"}
          item={editing}
          open={dialogOpen}
          onOpenChange={onOpenChange}
          onSaved={close}
        />
      }
    />
  );
}

function FormSummary({ items }: { items: SignupFormRow[] }): ReactNode {
  const published = items.filter((item) => item.status === "published").length;
  const submissions = items.reduce((total, item) => total + item.submissionCount, 0);
  return (
    <MetricGrid className="sm:grid-cols-3">
      {[
        {
          label: "フォーム",
          value: items.length,
          description: "現在のフォーム数",
          icon: Rows3,
        },
        {
          label: "公開中",
          value: published,
          description: "訪問者が送信可能",
          icon: ExternalLink,
        },
        {
          label: "累計送信",
          value: submissions,
          description: "フォーム送信の合計",
          icon: Code2,
        },
      ].map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          description={
            <div className="flex items-center gap-2 text-sm">
              <item.icon />
              {item.description}
            </div>
          }
        />
      ))}
    </MetricGrid>
  );
}

function SignupFormEditor({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: SignupFormRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const initialFields = useMemo(
    () => new Set(item?.definition.fields?.map((field) => field.key) ?? []),
    [item],
  );
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const [turnstileEnabled, setTurnstileEnabled] = useState(item?.turnstileEnabled ?? true);
  const [optionalFields, setOptionalFields] = useState(
    new Set(
      ["firstName", "lastName", "phone"].filter((field) =>
        initialFields.has(field as "firstName" | "lastName" | "phone"),
      ),
    ),
  );
  const [customFields, setCustomFields] = useState<FormField[]>(
    () => item?.definition.fields?.filter((field) => field.kind === "custom") ?? [],
  );

  const createForm = useCreateSignupForm();
  const updateForm = useUpdateSignupForm();

  function toggleField(field: string, checked: boolean): void {
    setOptionalFields((current) => {
      const next = new Set(current);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = getFormString(formData, "name").trim();
    const slug = getFormString(formData, "slug").trim();
    const standard = (key: FormField["key"], type: FormField["type"]): FormField => ({
      key,
      kind: "standard",
      type,
      required: key === "email",
      progressive: false,
    });
    const fields: FormField[] = [standard("email", "email")];
    if (optionalFields.has("firstName")) fields.push(standard("firstName", "text"));
    if (optionalFields.has("lastName")) fields.push(standard("lastName", "text"));
    if (optionalFields.has("phone")) fields.push(standard("phone", "tel"));
    // Blank keys are half-finished rows in the builder, not fields to save.
    fields.push(...customFields.filter((field) => field.key.trim().length > 0));
    const allowedDomains = getFormString(formData, "allowedDomains")
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const payload = {
      name,
      status: getFormString(formData, "status") === "published" ? "published" : "draft",
      definition: {
        style: readFormStyle(formData),
        fields,
        progressiveMaxFields: Number(getFormString(formData, "progressiveMaxFields")) || 3,
      },
      allowedDomains,
      turnstileEnabled,
      successMessage: getFormString(formData, "successMessage"),
    } as const;
    await run(async () => {
      if (item) {
        await updateForm.mutateAsync({ id: item.id, ...payload, slug: slug || item.slug });
        toast.success("フォームを更新しました");
      } else {
        await createForm.mutateAsync({ ...payload, ...(slug ? { slug } : {}) });
        toast.success("フォームを作成しました");
      }
      onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "フォームを編集" : "フォームを作成"}
      description="メールアドレスはすべてのフォームで必須です。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "フォームを作成"}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="名前"
          name="name"
          defaultValue={item?.name}
          placeholder="ニュースレター登録"
          required
        />
        <FormInput
          label="スラッグ"
          name="slug"
          defaultValue={item?.slug}
          description="未入力なら名前から自動生成します。"
          placeholder="newsletter"
        />
        <FormNativeSelect
          label="フォーム形式"
          name="style"
          defaultValue={item?.definition.style ?? "inline"}
        >
          <FormSelectOption value="inline">インライン</FormSelectOption>
          <FormSelectOption value="floating-bar">フローティングバー</FormSelectOption>
          <FormSelectOption value="floating-box">フローティングボックス</FormSelectOption>
          <FormSelectOption value="modal">モーダル</FormSelectOption>
        </FormNativeSelect>
        <FormNativeSelect label="公開状態" name="status" defaultValue={item?.status ?? "draft"}>
          <FormSelectOption value="draft">下書き</FormSelectOption>
          <FormSelectOption value="published">公開</FormSelectOption>
        </FormNativeSelect>
      </FieldGroup>

      <FieldSet>
        <FieldLegend variant="label">取得する項目</FieldLegend>
        <FieldDescription>
          メールアドレスは必須です。連絡先の標準カラムに保存されます。
        </FieldDescription>
        <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
          <Field orientation="horizontal" data-disabled>
            <Checkbox id="field-email" checked disabled />
            <FieldLabel htmlFor="field-email">メールアドレス（必須）</FieldLabel>
          </Field>
          {(
            [
              ["firstName", "名"],
              ["lastName", "姓"],
              ["phone", "電話番号"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} orientation="horizontal">
              <Checkbox
                id={`field-${key}`}
                checked={optionalFields.has(key)}
                onCheckedChange={(checked) => toggleField(key, Boolean(checked))}
              />
              <FieldLabel htmlFor={`field-${key}`}>{label}</FieldLabel>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>

      <FormFieldBuilder fields={customFields} onChange={setCustomFields} />
      <FormInput
        label="1回に質問する段階的項目の上限"
        name="progressiveMaxFields"
        type="number"
        min={1}
        max={10}
        defaultValue={item?.definition.progressiveMaxFields ?? 3}
        description="「段階的に質問」を付けた項目のうち、未回答のものをこの件数まで表示します。"
      />

      <FormTextarea
        label="許可ドメイン"
        name="allowedDomains"
        defaultValue={item?.allowedDomains.join("\n")}
        description="1行に1ドメイン。空欄ならすべてのドメインから送信できます。"
        placeholder={"example.com\ncampaign.example.com"}
        rows={3}
      />
      <FormInput
        label="送信完了メッセージ"
        name="successMessage"
        defaultValue={item?.successMessage ?? "ありがとうございます。"}
        required
      />
      <Field orientation="horizontal">
        <Switch
          id="form-turnstile"
          checked={turnstileEnabled}
          onCheckedChange={setTurnstileEnabled}
        />
        <FieldContent>
          <FieldLabel htmlFor="form-turnstile">
            <FieldTitle>Turnstileによるbot対策</FieldTitle>
            <FieldDescription>
              WorkerにTurnstileシークレットが設定されている場合に検証します。
            </FieldDescription>
          </FieldLabel>
        </FieldContent>
      </Field>
    </FormDialog>
  );
}

/** Narrows the select value to the union the form definition accepts. */
function readFormStyle(formData: FormData): NonNullable<SignupFormDefinition["style"]> {
  const value = getFormString(formData, "style");
  return value === "floating-bar" || value === "floating-box" || value === "modal"
    ? value
    : "inline";
}

function formStyleLabel(style?: SignupFormDefinition["style"]): string {
  return (
    {
      inline: "インライン",
      "floating-bar": "フローティングバー",
      "floating-box": "フローティングボックス",
      modal: "モーダル",
    }[style ?? "inline"] ?? "インライン"
  );
}
