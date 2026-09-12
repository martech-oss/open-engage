import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";

import { PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  emailArchivedTemplatesQueryOptions,
  emailTemplateOptionsQueryOptions,
  type EmailTemplateRow,
  emailVariablesListQueryOptions,
  type MessageVariableRow,
} from "@/features/emails/email-api";

import { ArchivedResources } from "./email-archived-resources";
import { TemplateForm, VariableForm } from "./email-forms";
import { TemplateTable } from "./email-tables";
import { VariableReference, VariableTable } from "./email-variable-tables";

type EmailSection = "templates" | "variables" | "archive";

export function EmailTemplatesPage(): ReactNode {
  const templatesQuery = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const variablesQuery = useSuspenseQuery(emailVariablesListQueryOptions());
  return (
    <EmailCenterPage
      view="templates"
      templates={templatesQuery.data}
      variables={variablesQuery.data}
      loading={templatesQuery.isFetching}
    />
  );
}

export function EmailVariablesPage(): ReactNode {
  const variablesQuery = useSuspenseQuery(emailVariablesListQueryOptions());
  return (
    <EmailCenterPage
      view="variables"
      variables={variablesQuery.data}
      loading={variablesQuery.isFetching}
    />
  );
}

export function EmailArchivePage(): ReactNode {
  const templatesQuery = useSuspenseQuery(emailArchivedTemplatesQueryOptions());
  return (
    <EmailCenterPage
      view="archive"
      archivedTemplates={templatesQuery.data}
      loading={templatesQuery.isFetching}
    />
  );
}

function EmailCenterPage({
  view,
  templates = [],
  variables = [],
  archivedTemplates = [],
  loading,
}: {
  view: EmailSection;
  templates?: EmailTemplateRow[];
  variables?: MessageVariableRow[];
  archivedTemplates?: EmailTemplateRow[];
  loading: boolean;
}): ReactNode {
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplateRow | null>(null);
  const [editingVariable, setEditingVariable] = useState<MessageVariableRow | null>(null);
  const [templateFormSession, setTemplateFormSession] = useState(0);
  const [startWithAi, setStartWithAi] = useState(false);

  function openTemplateForm(template: EmailTemplateRow | null, ai: boolean): void {
    setEditingTemplate(template);
    setStartWithAi(ai);
    setTemplateFormSession((current) => current + 1);
    setShowTemplateForm(true);
  }

  const pageTitle = {
    templates: "メールテンプレート",
    variables: "メッセージ変数",
    archive: "メールアーカイブ",
  }[view];

  const action =
    view === "templates" ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button />}>
          <Plus data-icon="inline-start" />
          メールを作成
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openTemplateForm(null, false)}>
            <Plus />
            手動で作成
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openTemplateForm(null, true)}>
            <Sparkles />
            AIでメールを作成
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : view === "variables" ? (
      <Button
        onClick={() => {
          setEditingVariable(null);
          setShowVariableForm(true);
        }}
      >
        <Plus data-icon="inline-start" />
        メッセージ変数
      </Button>
    ) : undefined;

  return (
    <PageLayout title={pageTitle} action={action}>
      {view === "templates" ? (
        <>
          <TemplateTable
            items={templates}
            loading={loading}
            onEdit={(template) => {
              openTemplateForm(template, false);
            }}
          />
          <VariableReference variables={variables} />
        </>
      ) : null}

      {view === "variables" ? (
        <>
          <VariableReference variables={variables} />
          <VariableTable
            items={variables}
            loading={loading}
            onEdit={(variable) => {
              setEditingVariable(variable);
              setShowVariableForm(true);
            }}
          />
        </>
      ) : null}

      {view === "archive" ? (
        <ArchivedResources templates={archivedTemplates} loading={loading} />
      ) : null}

      <TemplateForm
        key={`${editingTemplate?.id ?? "new-template"}-${templateFormSession}`}
        open={showTemplateForm}
        onOpenChange={setShowTemplateForm}
        template={editingTemplate}
        initialAiOpen={startWithAi}
        onSaved={() => {
          setShowTemplateForm(false);
          setEditingTemplate(null);
        }}
      />

      <VariableForm
        open={showVariableForm}
        onOpenChange={setShowVariableForm}
        variable={editingVariable}
        onSaved={() => {
          setShowVariableForm(false);
          setEditingVariable(null);
        }}
      />
    </PageLayout>
  );
}
