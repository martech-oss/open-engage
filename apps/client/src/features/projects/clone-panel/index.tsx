import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useProjectCloneController } from "./controller";
import { ProjectCloneDialog } from "./dialog";
import { CloneHistory } from "./history";

export function ProjectClonePanel({
  projectId,
  projectName,
  canEdit = true,
}: {
  projectId: string;
  projectName: string;
  canEdit?: boolean;
}) {
  const controller = useProjectCloneController(projectId);
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="施策の複製">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">施策の複製</h2>
          <p className="text-sm text-muted-foreground">
            設定と関連リソースを、新しい施策の下書きとして作成します。
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => controller.setOpen(true)}>
            <Copy />
            複製
          </Button>
        )}
      </div>
      <CloneHistory
        items={controller.list.data?.items}
        error={controller.list.error}
        fetching={controller.list.isFetching}
        hasPrevious={controller.hasPrevious}
        hasNext={Boolean(controller.list.data?.nextCursor)}
        canEdit={canEdit}
        onPrevious={controller.previousPage}
        onNext={controller.nextPage}
      />
      {controller.open && (
        <ProjectCloneDialog
          projectId={projectId}
          projectName={projectName}
          onOpenChange={controller.setOpen}
        />
      )}
    </section>
  );
}
