import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";

import { PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
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
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => openTemplateForm(null, false)}>
          <Plus data-icon="inline-start" />
          手動で作成
        </Button>
        <Button onClick={() => openTemplateForm(null, true)}>
          <Sparkles data-icon="inline-start" />
          AIでメールを作成
        </Button>
      </div>
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
