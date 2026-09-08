import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui/form-fields";
import { Button } from "@/components/ui/button";
import type { VariableType, VariableUsage } from "@openengage/core/projects";

import { useVariableSettings } from "./variable-controller";

const usageKey = (item: VariableUsage) =>
  JSON.stringify([item.resourceType, item.resourceId, item.versionId, item.dependencyPath]);
function UsageDetails({ item }: { item: VariableUsage }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        解決元: {item.projectId ? `Project ${item.projectId}` : "Workspace"}
        {item.dependencyPath.length > 0 && ` · ${item.dependencyPath.join(" → ")}`}
      </p>
      {item.diagnostics.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </>
  );
}

export function VariableSettings({ projectId = null }: { projectId?: string | null }) {
  const {
    query,
    editing,
    setEditing,
    key,
    setKey,
    type,
    setType,
    value,
    setValue,
    revision,
    useKey,
    setUseKey,
    preview,
    setPreview,
    remove,
    uses,
    busy,
    error,
    inputId,
    own,
    edit,
    check,
    submit,
  } = useVariableSettings(projectId);
  if (query.isPending) return <p>変数を読み込み中…</p>;
  if (query.error) return <p role="alert">変数を読み込めませんでした: {query.error.message}</p>;
  return (
    <section
      className="space-y-4 rounded-xl border p-5"
      aria-label={projectId ? "Project変数" : "Workspace変数"}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{projectId ? "Project変数" : "Workspace変数"}</h2>
        {query.data.canEdit && (
          <Button type="button" onClick={() => edit()}>
            変数を追加
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        表示文では {"{{variables.key}}"}{" "}
        を使用できます。Projectの値がWorkspaceの値を上書きします。変更は次の公開で反映され、公開済みの版と実行は元の値を保持します。
      </p>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>キー / 型</th>
              <th>値</th>
              <th>定義元</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {query.data.effective.values.map((item) => (
              <tr key={item.key} className="border-t">
                <td className="py-3">
                  {item.key}
                  <small className="block text-muted-foreground">
                    {item.type} · v{item.revision}
                  </small>
                </td>
                <td className="max-w-xs break-words">{String(item.value)}</td>
                <td>{item.projectId ? "Project" : "Workspace"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`${item.key} の使用箇所`}
                      onClick={() => setUseKey(useKey === item.key ? null : item.key)}
                    >
                      使用箇所
                    </Button>
                    {query.data.canEdit && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`${item.key} を${own(item) ? "編集" : "上書き"}`}
                          onClick={() => edit(item)}
                        >
                          {own(item) ? "編集" : "上書き"}
                        </Button>
                        {own(item) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`${item.key} を削除`}
                            onClick={() => edit(item, true)}
                          >
                            削除
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!query.data.effective.values.length && (
        <p className="text-sm text-muted-foreground">変数はまだありません。</p>
      )}
      {useKey && (
        <div className="rounded border p-3">
          <h3 className="font-medium">{useKey} の使用箇所</h3>
          {uses.isPending ? (
            <p>読み込み中…</p>
          ) : uses.error ? (
            <p role="alert">{uses.error.message}</p>
          ) : uses.data?.length ? (
            <ul>
              {uses.data.map((item) => (
                <li key={usageKey(item)}>
                  {item.name} · {item.resourceType} · {item.published ? "公開版" : "下書き"}{" "}
                  {item.versionId}
                  <UsageDetails item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <p>使用箇所はありません。</p>
          )}
        </div>
      )}
      {editing && query.data.canEdit && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">{remove ? "変数を削除" : "変数を編集"}</h3>
          <FormInput
            id={`${inputId}-key`}
            name="variableKey"
            label="キー"
            value={key}
            disabled={revision > 0 || remove || busy}
            onChange={(event) => {
              setKey(event.target.value);
              setPreview(null);
            }}
          />
          <FormNativeSelect
            id={`${inputId}-type`}
            name="variableType"
            label="型"
            value={type}
            disabled={revision > 0 || remove || busy}
            onChange={(event) => {
              setType(event.target.value as VariableType);
              setValue(event.target.value === "boolean" ? "false" : "");
              setPreview(null);
            }}
          >
            {["string", "number", "boolean", "datetime", "url"].map((option) => (
              <FormSelectOption key={option} value={option}>
                {option}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          {type === "boolean" ? (
            <FormNativeSelect
              id={`${inputId}-value`}
              name="variableValue"
              label="値"
              value={value}
              disabled={remove || busy}
              onChange={(event) => {
                setValue(event.target.value);
                setPreview(null);
              }}
            >
              <FormSelectOption value="false">false</FormSelectOption>
              <FormSelectOption value="true">true</FormSelectOption>
            </FormNativeSelect>
          ) : (
            <FormInput
              id={`${inputId}-value`}
              name="variableValue"
              label="値"
              value={value}
              disabled={remove || busy}
              type={type === "number" ? "number" : "text"}
              step="any"
              placeholder={type === "datetime" ? "2026-09-08T09:00:00+09:00" : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setPreview(null);
              }}
            />
          )}
          {remove && (
            <p className="text-sm">
              Projectの上書きを削除するとWorkspaceの値を継承します。公開済みの値は保持されます。
            </p>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={() => void check()}>
            影響を確認
          </Button>
          {preview && (
            <div className="space-y-2" aria-live="polite">
              <h4 className="font-medium">変更内容と使用箇所</h4>
              {preview.length ? (
                preview.map((item) => (
                  <div key={usageKey(item)} className="rounded bg-muted p-2 text-sm">
                    <p>{item.name}</p>
                    <UsageDetails item={item} />
                    <p>
                      {String(item.before ?? "未定義")} → {String(item.after ?? "未定義")}
                    </p>
                    <p>
                      {item.error ??
                        (item.requiresRepublish ? "再公開が必要" : "公開版への変更なし")}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm">使用箇所はありません。</p>
              )}
              <Button type="button" disabled={busy} onClick={() => void submit()}>
                {remove ? "削除を確定" : "変更を保存"}
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            キャンセル
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
