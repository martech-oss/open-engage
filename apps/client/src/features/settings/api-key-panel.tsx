import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorAlert, LoadingButton } from "@/components/app-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { useApiKeyController } from "./api-key-controller";

export function ApiKeyPanel({ canManage }: { canManage: boolean }): ReactNode {
  const controller = useApiKeyController();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <KeyRound />
          </div>
          <div>
            <CardTitle>Workspace APIキー</CardTitle>
            <CardDescription>SDK/MCP用。キーは作成時に一度だけ表示されます。</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        {canManage ? (
          <LoadingButton
            variant="outline"
            busy={controller.busy}
            busyLabel="作成中…"
            onClick={() => void controller.create()}
          >
            APIキーを作成
          </LoadingButton>
        ) : (
          <p className="text-sm text-muted-foreground">管理者のみ作成できます。</p>
        )}
        {controller.error ? <ErrorAlert>{controller.error}</ErrorAlert> : null}
        {controller.token ? (
          <pre className="w-full overflow-x-auto rounded-lg bg-muted p-4 text-xs">
            {controller.token}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
