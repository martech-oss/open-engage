import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { appBootstrapQueryOptions } from "@/lib/app-bootstrap";
import { getFormString } from "@/lib/form-data";
import { formatMoney } from "@/lib/format";
import type { CampaignCostInput } from "@openengage/core/projects";

import {
  campaignCostsQueryOptions,
  useCreateCampaignCost,
  useDeleteCampaignCost,
  useUpdateCampaignCost,
} from "./cost-api";
import type { CampaignsReport } from "./report-api";
import { ReportTableCard } from "./report-widgets";

type Cost = CampaignCostInput & { id: string };
export function CampaignCostsPanel({
  campaigns,
  currency,
}: {
  campaigns: CampaignsReport["campaigns"];
  currency: string;
}) {
  const [project, setProject] = useState(campaigns[0]?.id ?? "");
  return (
    <ReportTableCard title="キャンペーン費用">
      <div className="space-y-4 p-4">
        <FormNativeSelect
          label="費用を登録するプロジェクト"
          name="costProject"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <FormSelectOption value="">選択してください</FormSelectOption>
          {campaigns.map((row) => (
            <FormSelectOption key={row.id} value={row.id}>
              {row.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        {project ? <ProjectCosts key={project} projectId={project} currency={currency} /> : null}
      </div>
    </ReportTableCard>
  );
}
function ProjectCosts({ projectId, currency }: { projectId: string; currency: string }) {
  const { data: costs = [], error } = useQuery(campaignCostsQueryOptions(projectId));
  const { data: bootstrap } = useQuery(appBootstrapQueryOptions());
  const canManage = bootstrap?.workspace?.capabilities.manageMarketing ?? false;
  const [editing, setEditing] = useState<Cost | null>(null);
  const [formKey, setFormKey] = useState(0);
  const create = useCreateCampaignCost(),
    update = useUpdateCampaignCost(),
    remove = useDeleteCampaignCost();
  const [costId, setCostId] = useState(() => crypto.randomUUID());
  const pending = create.isPending || update.isPending || remove.isPending;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      id: projectId,
      costId: editing?.id ?? costId,
      bookedOn: getFormString(values, "bookedOn"),
      category: getFormString(values, "category"),
      amount: Number(values.get("amount")),
      currency: getFormString(values, "currency").toUpperCase(),
    };
    try {
      if (editing) await update.mutateAsync(input);
      else await create.mutateAsync(input);
      setEditing(null);
      setCostId(crypto.randomUUID());
      setFormKey((key) => key + 1);
    } catch {
      /* The mutation error is rendered below. */
    }
  }
  const columns: DataTableColumn<Cost>[] = [
    { key: "bookedOn", header: "計上日", cell: (row) => row.bookedOn },
    { key: "category", header: "費目", cell: (row) => row.category },
    { key: "amount", header: "金額", cell: (row) => formatMoney(row.amount, row.currency) },
    { key: "currency", header: "通貨", cell: (row) => row.currency },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: Cost) => (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setEditing(row);
                    setFormKey((key) => key + 1);
                  }}
                >
                  編集
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove.mutate({ id: projectId, costId: row.id })}
                >
                  削除
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="space-y-4">
      <DataTable
        emptyTitle="データがありません"
        rows={costs}
        columns={columns}
        rowKey={(row) => row.id}
        caption="登録済み費用（全期間・通貨別）"
      />
      {canManage ? (
        <form key={formKey} onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormInput
            label="計上日"
            name="bookedOn"
            type="date"
            defaultValue={editing?.bookedOn}
            required
          />
          <FormInput
            label="費目"
            name="category"
            defaultValue={editing?.category ?? ""}
            maxLength={191}
            required
          />
          <FormInput
            label="金額"
            name="amount"
            type="number"
            step="0.01"
            min={0}
            defaultValue={editing?.amount ?? ""}
            required
          />
          <FormInput
            label="通貨"
            name="currency"
            maxLength={3}
            pattern="[A-Za-z]{3}"
            defaultValue={editing?.currency ?? currency}
            required
          />
          <Button disabled={pending} type="submit">
            {editing ? "費用を更新" : "費用を登録"}
          </Button>
          {editing ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setFormKey((key) => key + 1);
              }}
            >
              キャンセル
            </Button>
          ) : null}
        </form>
      ) : null}
      {(error ?? create.error ?? update.error ?? remove.error) ? (
        <p role="alert" className="text-destructive">
          {(error ?? create.error ?? update.error ?? remove.error)?.message}
        </p>
      ) : null}
    </div>
  );
}
