import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BriefcaseBusiness,
  CircleDollarSign,
  CircleX,
  Plus,
  Search,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AppDialog,
  EmptyState,
  FormNativeSelect,
  FormSelectOption,
  MetricCard,
  PageLayout,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  dealOptionsQueryOptions,
  dealsQueryOptions,
  useCreateDeal,
  useMoveDeal,
  type DealSearch,
} from "@/features/deals/deal-api";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatMoney } from "@/lib/format";

import { DealBoard } from "../deal-board";
import { DealForm } from "../deal-forms";

export function DealsPage({ search }: { search: DealSearch }): ReactNode {
  const navigate = useNavigate();
  const { data: options } = useSuspenseQuery(dealOptionsQueryOptions());
  const { data: deals } = useSuspenseQuery(dealsQueryOptions(search));
  const [query, setQuery] = useState(search.q);
  const [showCreate, setShowCreate] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const activePipeline =
    options.pipelines.find((pipeline) => pipeline.id === search.pipelineId) ??
    options.pipelines.find((pipeline) => pipeline.isDefault) ??
    options.pipelines[0];

  const createDeal = useCreateDeal();
  const moveDeal = useMoveDeal();

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
      title="Deal"
      action={
        <Button onClick={() => setShowCreate(true)} disabled={!activePipeline}>
          <Plus data-icon="inline-start" />
          商談を作成
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="進行中の商談"
          value={`${deals.summary.openCount.toLocaleString()}件`}
          description={formatMoney(deals.summary.openValue, "JPY")}
          icon={<BriefcaseBusiness />}
        />
        <MetricCard
          label="獲得済み"
          value={`${deals.summary.wonCount.toLocaleString()}件`}
          description={formatMoney(deals.summary.wonValue, "JPY")}
          icon={<CircleDollarSign />}
        />
        <MetricCard
          label="失注"
          value={`${deals.summary.lostCount.toLocaleString()}件`}
          description="パイプライン累計"
          icon={<CircleX />}
        />
        <MetricCard
          label="パイプライン"
          value={activePipeline?.name ?? "未設定"}
          description={`${activePipeline?.stages.length ?? 0}ステージ`}
          icon={<UsersRound />}
        />
      </div>

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
        />
      ) : (
        <EmptyState
          title="パイプラインがありません"
          description="ワークスペースのセール設定を確認してください。"
        />
      )}

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
