import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  ErrorAlert,
  FormInput,
  FormTextarea,
  LoadingButton,
  PageLayout,
} from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { projectsQueryOptions, useCreateProject } from "./program-api";
import type { ProjectBriefSearch } from "./project-brief-list-filters";
import { ProjectBriefsPage } from "./project-brief-list-page";
export function ProjectsPage({
  search,
}: {
  search: ProjectBriefSearch & { view: "projects" | "briefs" };
}) {
  const { data } = useSuspenseQuery(projectsQueryOptions());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const create = useCreateProject();
  const navigate = useNavigate();
  const { formatDateTime } = useWorkspaceFormatters();
  async function save() {
    setError("");
    try {
      const result = await create.mutateAsync({ name, description });
      await navigate({ to: "/projects/$id", params: { id: result.id } });
    } catch (cause) {
      setError(getErrorMessage(cause, "施策を作成できませんでした"));
    }
  }
  const tabs = (
    <nav className="flex gap-4 border-b pb-3 text-sm">
      <Link
        to="/projects"
        search={{ view: "projects" }}
        className={search.view === "projects" ? "font-semibold" : ""}
      >
        施策一覧
      </Link>
      <Link
        to="/projects"
        search={{ view: "briefs" }}
        className={search.view === "briefs" ? "font-semibold" : ""}
      >
        施策ブリーフ
      </Link>
    </nav>
  );
  if (search.view === "briefs")
    return (
      <div className="flex h-full flex-col">
        <div className="px-6 pt-4">{tabs}</div>
        <div className="min-h-0 flex-1">
          <ProjectBriefsPage search={search} />
        </div>
      </div>
    );
  return (
    <PageLayout
      title="施策"
      action={
        data.allowedActions.create ? (
          <Button onClick={() => setOpen(true)}>施策を作成</Button>
        ) : undefined
      }
    >
      {tabs}
      <p className="text-sm text-muted-foreground">
        資料請求・問い合わせ・イベントの参加者と成果を管理します。ブリーフなしでも利用できます。
      </p>
      <FormInput
        name="project-query"
        label="施策を検索"
        placeholder="施策名"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-3">施策</th>
              <th className="p-3">リンク済みリソース</th>
              <th className="p-3">更新日時</th>
            </tr>
          </thead>
          <tbody>
            {data.projects
              .filter((p) =>
                `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">
                    <Link
                      to="/projects/$id"
                      params={{ id: p.id }}
                      className="font-medium underline underline-offset-4"
                    >
                      {p.name}
                    </Link>
                    <p className="mt-1 text-muted-foreground">{p.description}</p>
                  </td>
                  <td className="p-3">{p.itemCount}</td>
                  <td className="p-3">{formatDateTime(p.updatedAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {data.projects.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">最初の施策を作成してください</p>
        )}
      </div>
      {open && (
        <AppDialog open title="施策を作成" onOpenChange={setOpen}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {error && <ErrorAlert>{error}</ErrorAlert>}
            <FormInput
              name="project-name"
              label="施策名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={191}
            />
            <FormTextarea
              name="project-description"
              label="説明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
            <LoadingButton type="submit" busy={create.isPending} disabled={!name.trim()}>
              施策を作成
            </LoadingButton>
          </form>
        </AppDialog>
      )}
    </PageLayout>
  );
}
