import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { ErrorAlert, PageLayout } from "@/components/app-ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getErrorMessage } from "@/hooks/use-form-submission";
import {
  PROJECT_PROGRAM_TEMPLATES,
  type ProjectProgramDefinition,
} from "@openengage/core/projects";

import { ProjectClonePanel } from "./clone-panel";
import { programQueryOptions, usePublishProgram, useSaveProgram } from "./program-api";
import { ProgramCohortPanel } from "./program-cohort-panel";
import { ProgramDefinitionEditor } from "./program-definition-editor";
import { ProgramFormBindings } from "./program-form-bindings";
import { ProgramMembersPanel } from "./program-members-panel";
import { ProjectBriefDetailPage } from "./project-brief-pages";
import { VariableSettings } from "./variable-settings";
export function ProjectProgramPage({ id }: { id: string }) {
  const { data: detail } = useSuspenseQuery(programQueryOptions(id));
  const save = useSaveProgram();
  const publish = usePublishProgram();
  const [error, setError] = useState("");
  const program = detail.program;
  async function saveDefinition(definition: ProjectProgramDefinition) {
    setError("");
    try {
      await save.mutateAsync({ id, definition, expectedRowVersion: program?.rowVersion ?? 0 });
    } catch (cause) {
      setError(getErrorMessage(cause, "定義を保存できませんでした"));
    }
  }
  async function publishDefinition() {
    if (!program) return;
    setError("");
    try {
      await publish.mutateAsync({ id, expectedRowVersion: program.rowVersion, confirmed: true });
    } catch (cause) {
      setError(getErrorMessage(cause, "定義を公開できませんでした"));
    }
  }
  return (
    <PageLayout
      title={detail.project.name}
      action={
        <Link to="/projects" className="text-sm underline">
          施策一覧へ
        </Link>
      }
    >
      {detail.project.description && (
        <p className="text-sm text-muted-foreground">{detail.project.description}</p>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Tabs defaultValue={program?.publishedVersion ? "members" : "definition"}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="members">参加者</TabsTrigger>
          <TabsTrigger value="outcomes">成果</TabsTrigger>
          <TabsTrigger value="definition">定義・フォーム</TabsTrigger>
          <TabsTrigger value="brief">ブリーフ</TabsTrigger>
          <TabsTrigger value="variables">変数</TabsTrigger>
          <TabsTrigger value="clone">複製</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          {program?.publishedVersion ? (
            <ProgramMembersPanel
              id={id}
              program={program}
              canManage={detail.allowedActions.manageMembers}
            />
          ) : (
            <p className="py-8 text-muted-foreground">
              「定義・フォーム」で参加ステータスを保存・公開してから参加者を登録してください。
            </p>
          )}
        </TabsContent>
        <TabsContent value="outcomes">
          <ProgramCohortPanel id={id} />
        </TabsContent>
        <TabsContent value="definition" className="space-y-5">
          <ProgramDefinitionEditor
            key={program?.rowVersion ?? 0}
            definition={program?.definition ?? PROJECT_PROGRAM_TEMPLATES.event}
            editable={detail.allowedActions.editDefinition}
            publishable={Boolean(program) && detail.allowedActions.publishDefinition}
            publishedVersion={program?.publishedVersion ?? null}
            busy={save.isPending || publish.isPending}
            onSave={(definition) => void saveDefinition(definition)}
            onPublish={() => void publishDefinition()}
          />
          <ProgramFormBindings key={`forms-${program?.rowVersion ?? 0}`} detail={detail} />
          {program && (
            <details className="rounded border p-4">
              <summary>定義の公開履歴（{program.versions.length}版）</summary>
              {program.versions.map((v) => (
                <div key={v.version} className="border-t py-3 text-sm">
                  <p className="font-medium">
                    第{v.version}版 · {v.publishedAt}
                  </p>
                  <p>
                    {v.definition.statuses
                      .map((s) => `${s.label}${s.success ? "（成果）" : ""}`)
                      .join(" / ")}
                  </p>
                </div>
              ))}
            </details>
          )}
        </TabsContent>
        <TabsContent value="brief">
          {detail.brief ? (
            <ProjectBriefDetailPage id={id} />
          ) : (
            <p className="py-8 text-muted-foreground">
              この施策にはブリーフがありません。参加者管理はブリーフなしで利用できます。
            </p>
          )}
        </TabsContent>
        <TabsContent value="variables">
          <VariableSettings projectId={id} />
        </TabsContent>
        <TabsContent value="clone">
          <ProjectClonePanel
            projectId={id}
            projectName={detail.project.name}
            canEdit={detail.allowedActions.manageMembers}
          />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
