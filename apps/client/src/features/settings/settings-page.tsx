import { KeyRound } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { authClient } from "@/auth-client";
import { FormInput, PageLayout, SuccessAlert } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { createWorkspaceApiKey } from "@/features/settings/settings-api";
import { getFormString } from "@/lib/form-data";
import type { Workspace } from "@/lib/workspace";

export function SettingsPage({ workspace }: { workspace: Workspace }): ReactNode {
  const [apiKey, setApiKey] = useState("");

  async function createKey(): Promise<void> {
    const created = await createWorkspaceApiKey();
    setApiKey(created.token);
  }

  return (
    <PageLayout title="設定">
      <div className="grid gap-6 xl:grid-cols-2">
        <TwoFactorSettings />
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
            <Button variant="outline" onClick={() => void createKey()}>
              APIキーを作成
            </Button>
            {apiKey ? (
              <pre className="w-full overflow-x-auto rounded-lg bg-muted p-4 text-xs">{apiKey}</pre>
            ) : null}
          </CardContent>
        </Card>
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
      </div>
    </PageLayout>
  );
}

function TwoFactorSettings(): ReactNode {
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [verified, setVerified] = useState(false);

  async function enable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const password = getFormString(new FormData(event.currentTarget), "password");
    const result = await authClient.twoFactor.enable({
      password,
      issuer: "OpenEngage",
    });
    if (result.data) setSetup(result.data);
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code = getFormString(new FormData(event.currentTarget), "code");
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.data) setVerified(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <KeyRound />
          </div>
          <div>
            <CardTitle>TOTP 二要素認証</CardTitle>
            <CardDescription>認証アプリを利用してログインを保護します。</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!setup ? (
          <form onSubmit={(event) => void enable(event)}>
            <FieldGroup>
              <FormInput label="現在のパスワード" name="password" type="password" required />
              <Button variant="outline" type="submit">
                セットアップを開始
              </Button>
            </FieldGroup>
          </form>
        ) : verified ? (
          <SuccessAlert>
            TOTPを有効にしました。バックアップコードを安全に保管してください。
          </SuccessAlert>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg bg-muted p-3 font-mono text-xs break-all">{setup.totpURI}</p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {setup.backupCodes.join("\n")}
            </pre>
            <form onSubmit={(event) => void verify(event)}>
              <FieldGroup className="flex-row items-end gap-2">
                <FormInput
                  label="認証コード"
                  name="code"
                  inputMode="numeric"
                  placeholder="6桁コード"
                  required
                />
                <Button type="submit">確認</Button>
              </FieldGroup>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
