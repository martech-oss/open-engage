import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  ErrorAlert,
  FormInput,
  FormTextarea,
  LoadingButton,
  PageLayout,
} from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { projectsQueryOptions, useCreateProject } from "./program-api";
import type { ProjectBriefSearch } from "./project-brief-list-filters";
import { ProjectBriefsPage } from "./project-brief-list-page";
export function ProjectsPage({
  search,
}: {
  search: ProjectBriefSearch & { view: "projects" | "briefs"; q?: string | undefined };
}) {
  const { data } = useSuspenseQuery(projectsQueryOptions());
  const [query, setQuery] = useState(search.q ?? "");
  useEffect(() => setQuery(search.q ?? ""), [search.q]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const create = useCreateProject();
  const navigate = useNavigate();
  const { formatDateTime } = useWorkspaceFormatters();
  function updateQuery(value: string) {
    setQuery(value);
    void navigate({ to: "/projects", search: { ...search, q: value || undefined }, replace: true });
  }
  async function save() {
    setError("");
    try {
      const result = await create.mutateAsync({ name, description });
      await navigate({
        to: "/projects/$id",
        params: { id: result.id },
        search: { q: query || undefined },
      });
    } catch (cause) {
      setError(getErrorMessage(cause, "施策を作成できませんでした"));
    }
  }
  const filteredProjects = data.projects.filter((project) =>
    `${project.name} ${project.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const columns: DataTableColumn<(typeof data.projects)[number]>[] = [
    {
      key: "name",
      header: "施策名",
      sortValue: (project) => project.name,
      cell: (project) => (
        <Link
          to="/projects/$id"
          params={{ id: project.id }}
          search={{ q: query || undefined }}
          className="font-medium hover:underline"
        >
          {project.name}
        </Link>
      ),
    },
    {
      key: "description",
      header: "説明",
      cell: (project) => (
        <span
          className="block max-w-xl truncate text-muted-foreground"
          title={project.description ?? undefined}
        >
          {project.description || "—"}
        </span>
      ),
    },
    {
      key: "itemCount",
      header: "リソース数",
      sortValue: (project) => project.itemCount,
      cell: (project) => `${project.itemCount.toLocaleString()}件`,
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "updatedAt",
      header: "更新日時",
      sortValue: (project) => project.updatedAt,
      cell: (project) => formatDateTime(project.updatedAt),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums whitespace-nowrap",
    },
  ];
  if (search.view === "briefs") return <ProjectBriefsPage search={search} />;
  return (
    <PageLayout
      title="施策"
      action={
        data.allowedActions.create ? (
          <Button onClick={() => setOpen(true)}>施策を作成</Button>
        ) : undefined
      }
    >
      <p className="text-sm text-muted-foreground">
        資料請求・問い合わせ・イベントの参加者と成果を管理します。ブリーフなしでも利用できます。
      </p>
      <FormInput
        name="project-query"
        label="施策を検索"
        placeholder="施策名・説明で検索"
        value={query}
        onChange={(e) => updateQuery(e.target.value)}
      />
      <DataTable
        columns={columns}
        rows={filteredProjects}
        rowKey={(project) => project.id}
        caption="施策一覧"
        emptyTitle={query.trim() ? "検索条件に一致する施策はありません" : "施策はまだありません"}
        emptyDescription={
          query.trim()
            ? "施策名や説明のキーワードを変更してください。"
            : data.allowedActions.create
              ? "最初の施策を作成して、参加者と成果の管理を始めましょう。"
              : "閲覧できる施策が作成されると、ここに表示されます。"
        }
        emptyAction={
          query.trim() ? (
            <Button variant="outline" onClick={() => updateQuery("")}>
              検索をクリア
            </Button>
          ) : undefined
        }
      />
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
