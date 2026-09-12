import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { ErrorAlert, PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
export function ProjectProgramPage({
  id,
  listQuery,
}: {
  id: string;
  listQuery?: string | undefined;
}) {
  const { data: detail } = useSuspenseQuery(programQueryOptions(id));
  const save = useSaveProgram();
  const publish = usePublishProgram();
  const [cloneOpen, setCloneOpen] = useState(false);
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
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to="/projects" search={{ view: "projects", q: listQuery }} />}
          >
            施策一覧へ
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" aria-label="施策の操作" />}
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCloneOpen((open) => !open)}>
                複製・複製履歴
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      {detail.project.description && (
        <p className="text-sm text-muted-foreground">{detail.project.description}</p>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {cloneOpen && (
        <ProjectClonePanel
          projectId={id}
          projectName={detail.project.name}
          canEdit={detail.allowedActions.manageMembers}
        />
      )}
      <Tabs defaultValue={program?.publishedVersion ? "outcomes" : "settings"}>
        <TabsList variant="line" className="mb-4 h-10 border-b">
          <TabsTrigger value="outcomes">成果</TabsTrigger>
          <TabsTrigger value="members">参加者</TabsTrigger>
          <TabsTrigger value="settings">設定</TabsTrigger>
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
              「設定」の「定義・フォーム」で参加ステータスを保存・公開してから参加者を登録してください。
            </p>
          )}
        </TabsContent>
        <TabsContent value="outcomes">
          <ProgramCohortPanel id={id} />
        </TabsContent>
        <TabsContent value="settings">
          <Tabs defaultValue="definition">
            <TabsList className="mb-4 h-auto flex-wrap" aria-label="施策設定">
              <TabsTrigger value="definition">定義・フォーム</TabsTrigger>
              <TabsTrigger value="brief">ブリーフ</TabsTrigger>
              <TabsTrigger value="variables">変数</TabsTrigger>
            </TabsList>
            <TabsContent value="definition" className="space-y-4">
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
          </Tabs>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
