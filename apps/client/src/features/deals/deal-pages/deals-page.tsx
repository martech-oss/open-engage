import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, FormNativeSelect, FormSelectOption, PageLayout } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  dealOptionsQueryOptions,
  dealsQueryOptions,
  useCreateDeal,
  useMoveDeal,
  useUpdateDealPipeline,
  type DealSearch,
  type DealStage,
} from "@/features/deals/deal-api";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { getErrorMessage } from "@/hooks/use-form-submission";

import { DealBoard } from "../deal-board";
import { DealForm } from "../deal-forms";
import { DealPipelineForm } from "../deal-pipeline-form";
import { DealStageForm, type DealStageDraft } from "../deal-stage-form";

export function DealsPage({ search }: { search: DealSearch }): ReactNode {
  const navigate = useNavigate();
  const { data: options } = useSuspenseQuery(dealOptionsQueryOptions());
  const { data: deals } = useSuspenseQuery(dealsQueryOptions(search));
  const [query, setQuery] = useState(search.q);
  const [showCreate, setShowCreate] = useState(false);
  const [pipelineForm, setPipelineForm] = useState<"create" | "edit" | null>(null);
  const [stageForm, setStageForm] = useState<"add" | DealStage | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const activePipeline =
    options.pipelines.find((pipeline) => pipeline.id === search.pipelineId) ??
    options.pipelines.find((pipeline) => pipeline.isDefault) ??
    options.pipelines[0];

  const createDeal = useCreateDeal();
  const moveDeal = useMoveDeal();
  const updatePipeline = useUpdateDealPipeline();

  useEffect(() => {
    setQuery(search.q);
  }, [search.q]);

  useDebouncedSearch({
    value: query,
    onCommit: (value) => {
      if (value === search.q) return;
      void navigate({ to: "/deals", search: { ...search, q: value }, replace: true });
    },
  });

  async function saveStage(values: DealStageDraft): Promise<void> {
    if (!activePipeline || stageForm === null) return;
    const current = activePipeline.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      probability: stage.probability,
    }));
    const stages =
      stageForm === "add"
        ? [...current, values]
        : current.map((stage) => (stage.id === stageForm.id ? { ...stage, ...values } : stage));
    await updatePipeline.mutateAsync({ id: activePipeline.id, stages });
    toast.success(stageForm === "add" ? "ステージを追加しました" : "ステージを更新しました");
  }

  async function deleteStage(stageId: string): Promise<void> {
    if (!activePipeline) return;
    try {
      await updatePipeline.mutateAsync({
        id: activePipeline.id,
        stages: activePipeline.stages
          .filter((stage) => stage.id !== stageId)
          .map((stage) => ({
            id: stage.id,
            name: stage.name,
            color: stage.color,
            probability: stage.probability,
          })),
      });
      toast.success("ステージを削除しました");
    } catch (caught) {
      toast.error(getErrorMessage(caught, "ステージを削除できませんでした"));
    }
  }

  async function move(dealId: string, stageId: string): Promise<void> {
    setMovingId(dealId);
    try {
      await moveDeal.mutateAsync({ id: dealId, stageId });
    } catch (caught) {
      toast.error(getErrorMessage(caught, "ステージを変更できませんでした"));
    } finally {
      setMovingId(null);
    }
  }

  return (
    <PageLayout
      title="パイプライン"
      action={
        <Button onClick={() => setShowCreate(true)} disabled={!activePipeline}>
          <Plus data-icon="inline-start" />
          商談を作成
        </Button>
      }
    >
      <Card>
        <CardContent>
          <FieldGroup className="flex-row flex-wrap items-end gap-3">
            <FieldGroup className="min-w-52 flex-1">
              <FormNativeSelect
                label="パイプライン"
                name="pipeline"
                value={activePipeline?.id ?? ""}
                onChange={(event) =>
                  void navigate({
                    to: "/deals",
                    search: { ...search, pipelineId: event.target.value },
                  })
                }
              >
                {options.pipelines.map((pipeline) => (
                  <FormSelectOption key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </FormSelectOption>
                ))}
              </FormNativeSelect>
            </FieldGroup>
            <Button type="button" variant="outline" onClick={() => setPipelineForm("create")}>
              <Plus data-icon="inline-start" />
              作成
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!activePipeline}
              onClick={() => setPipelineForm("edit")}
            >
              <Pencil data-icon="inline-start" />
              ステージを編集
            </Button>
            <FieldGroup className="min-w-40">
              <FormNativeSelect
                label="ステータス"
                name="status"
                value={search.status}
                onChange={(event) =>
                  void navigate({
                    to: "/deals",
                    search: {
                      ...search,
                      status: event.target.value as DealSearch["status"],
                    },
                  })
                }
              >
                <FormSelectOption value="open">進行中</FormSelectOption>
                <FormSelectOption value="won">獲得</FormSelectOption>
                <FormSelectOption value="lost">失注</FormSelectOption>
                <FormSelectOption value="all">すべて</FormSelectOption>
              </FormNativeSelect>
            </FieldGroup>
            <Field className="min-w-64 flex-[2]">
              <FieldLabel htmlFor="deal-search">検索</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="deal-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="商談、連絡先、会社名で検索"
                />
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {activePipeline ? (
        <DealBoard
          pipeline={activePipeline}
          deals={deals.items}
          movingId={movingId}
          onMove={move}
          onCreate={() => setShowCreate(true)}
          onAddStage={() => setStageForm("add")}
          onEditStage={(stageId) => {
            const stage = activePipeline.stages.find((item) => item.id === stageId);
            if (stage) setStageForm(stage);
          }}
          onDeleteStage={(stageId) => void deleteStage(stageId)}
        />
      ) : (
        <EmptyState
          title="パイプラインがありません"
          description="最初のパイプラインを作成すると、商談のステージを管理できます。"
          action={
            <Button variant="outline" onClick={() => setPipelineForm("create")}>
              <Plus data-icon="inline-start" />
              パイプラインを作成
            </Button>
          }
        />
      )}

      <DealStageForm
        key={stageForm === "add" ? "add" : (stageForm?.id ?? "closed")}
        open={stageForm !== null}
        onOpenChange={(open) => {
          if (!open) setStageForm(null);
        }}
        initial={stageForm === "add" || stageForm === null ? null : stageForm}
        onSubmit={saveStage}
      />

      <DealPipelineForm
        key={`${pipelineForm}-${pipelineForm === "edit" ? (activePipeline?.id ?? "none") : "new"}`}
        open={pipelineForm !== null}
        onOpenChange={(open) => {
          if (!open) setPipelineForm(null);
        }}
        pipeline={pipelineForm === "edit" ? (activePipeline ?? null) : null}
        sourcePipeline={activePipeline ?? null}
        canArchive={options.pipelines.length > 1}
        onCreated={async (pipelineId) => {
          await navigate({ to: "/deals", search: { ...search, pipelineId } });
        }}
        onArchived={async () => {
          await navigate({ to: "/deals", search: { ...search, pipelineId: "" } });
        }}
      />

      {activePipeline ? (
        <AppDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          title="商談を作成"
          description="金額、ステージ、関連する顧客を登録します。"
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        >
          <DealForm
            options={options}
            initialPipelineId={activePipeline.id}
            submitLabel="商談を作成"
            onSubmit={async (values) => {
              const deal = await createDeal.mutateAsync(values);
              toast.success("商談を作成しました");
              setShowCreate(false);
              await navigate({ to: "/deals/$id", params: { id: deal.id } });
            }}
          />
        </AppDialog>
      ) : null}
    </PageLayout>
  );
}
