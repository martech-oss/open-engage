import { ErrorAlert, LoadingButton } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { useProjectCloneDialogController } from "./controller";
import { CloneJobProgress } from "./job-progress";
import { kindLabels } from "./labels";
import { CloneVariableInput } from "./variable-input";

export function ProjectCloneDialog({
  projectId,
  projectName,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const controller = useProjectCloneDialogController(projectId);
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="施策を複製"
      className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
    >
      {controller.error && <ErrorAlert>{controller.error}</ErrorAlert>}
      {!controller.job ? (
        <form onSubmit={(event) => void controller.prepare(event)} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="clone-name">複製先の名前</FieldLabel>
            <Input
              id="clone-name"
              name="name"
              defaultValue={`${projectName}（コピー）`}
              maxLength={191}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["ownerUserId", "approverUserId"] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`clone-${key}`}>
                  {key === "ownerUserId" ? "担当者" : "承認者"}
                </FieldLabel>
                <NativeSelect id={`clone-${key}`} name={key} defaultValue="">
                  <NativeSelectOption value="">選択してください</NativeSelectOption>
                  {controller.options?.members.map((person) => (
                    <NativeSelectOption key={person.id} value={person.id}>
                      {person.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="clone-review">レビュー日（{controller.timeZone}）</FieldLabel>
            <Input id="clone-review" name="reviewAt" type="datetime-local" />
          </Field>
          <p className="text-sm text-muted-foreground">
            ブリーフがある施策は、担当者・承認者・レビュー日の指定が必要です。
          </p>
          {(controller.variables?.effective.values.length ?? 0) > 0 && (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">複製先の変数</legend>
              {controller.variables?.effective.values.map((definition) => (
                <CloneVariableInput key={definition.key} definition={definition} />
              ))}
            </fieldset>
          )}
          <LoadingButton type="submit" busy={controller.previewPending}>
            コピー対象を確認
          </LoadingButton>
        </form>
      ) : controller.job.status === "preview" ? (
        <div className="space-y-4">
          <p>
            <strong>{controller.job.options.name}</strong>へ、以下の内容をコピーします。
          </p>
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">種類</th>
                  <th className="p-2">名前</th>
                  <th className="p-2">複製先スラッグ</th>
                </tr>
              </thead>
              <tbody>
                {controller.job.resources.map((resource) => (
                  <tr className="border-b" key={`${resource.kind}:${resource.sourceId}`}>
                    <td className="p-2">{kindLabels[resource.kind]}</td>
                    <td className="p-2">{resource.name}</td>
                    <td className="p-2 break-all">{resource.targetSlug ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {controller.job.sharedReferences.length > 0 && (
            <div>
              <h3 className="font-medium">共有する参照先</h3>
              <ul className="list-disc pl-5 text-sm">
                {controller.job.sharedReferences.map((reference) => (
                  <li key={`${reference.kind}:${reference.id}`}>
                    {reference.name}（{reference.kind}）
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            参加者・費用・成果・実行履歴は引き継がれません。複製先は下書きです。承認・公開・有効化を行って利用を開始してください。
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={controller.editSettings}>
              設定に戻る
            </Button>
            <LoadingButton busy={controller.startPending} onClick={() => void controller.begin()}>
              この内容で複製
            </LoadingButton>
          </div>
        </div>
      ) : (
        <CloneJobProgress job={controller.job} canEdit />
      )}
    </AppDialog>
  );
}
