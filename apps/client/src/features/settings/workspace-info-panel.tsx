import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Workspace } from "@/lib/workspace";

export function WorkspaceInfoPanel({ workspace }: { workspace: Workspace }): ReactNode {
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>現在のワークスペース情報</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">ID</dt>
            <dd className="font-mono">{workspace.id}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Slug</dt>
            <dd>{workspace.slug}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Timezone</dt>
            <dd>{workspace.timezone}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
