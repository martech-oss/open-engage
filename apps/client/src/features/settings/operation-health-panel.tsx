import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { ErrorAlert } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { operationHealthQueryOptions } from "./operation-health-api";

const labels = {
  schedule_delay: "定期実行の遅延",
  batch_failure: "対象者の登録失敗",
  call_failure: "共通処理の失敗",
  clone_failure: "施策複製の失敗",
};
export function OperationHealthPanel() {
  const health = useQuery({ ...operationHealthQueryOptions(), refetchInterval: 30_000 });
  const { formatDateTime } = useWorkspaceFormatters();
  return (
    <Card>
      <CardHeader>
        <CardTitle>運用状況</CardTitle>
        <CardDescription>
          定期実行、対象者登録、共通処理、施策複製の問題を確認します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {health.error && (
          <ErrorAlert>{getErrorMessage(health.error, "運用状況を取得できませんでした")}</ErrorAlert>
        )}
        {health.isPending && <p className="text-sm text-muted-foreground">確認中…</p>}
        {health.data?.issues.length === 0 && (
          <p className="text-sm">現在、確認が必要な問題はありません。</p>
        )}
        {health.data?.issues.map((issue) => (
          <div className="space-y-1 rounded-md border p-3" key={`${issue.kind}:${issue.id}`}>
            <p className="text-sm font-semibold">
              {labels[issue.kind]} · {issue.name}
            </p>
            <p className="text-sm break-words">{issue.message}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(issue.occurredAt)}</p>
            {issue.automationId ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/automations/$id" params={{ id: issue.automationId }} />}
              >
                実行履歴を確認
              </Button>
            ) : issue.projectId ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/projects/$id" params={{ id: issue.projectId }} />}
              >
                施策を確認
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
