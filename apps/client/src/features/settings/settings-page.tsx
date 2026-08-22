import { useQuery } from "@tanstack/react-query";
import { ImageIcon, KeyRound, Palette } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/auth-client";
import {
  FormInput,
  FormTextarea,
  ErrorAlert,
  LoadingButton,
  PageLayout,
  SuccessAlert,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetPickerDialog } from "@/features/assets/asset-picker";
import {
  emailBrandProfileQueryOptions,
  type EmailBrandProfile,
  useUpdateEmailBrandProfile,
} from "@/features/emails/email-api";
import { createWorkspaceApiKey } from "@/features/settings/settings-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import type { Workspace } from "@/lib/workspace";
import type { WorkspaceCapabilities } from "@openengage/core/workspaces";

export function settingsPermissions(capabilities: WorkspaceCapabilities): {
  canEditWorkspace: boolean;
  canManageApiKeys: boolean;
} {
  return {
    canEditWorkspace: capabilities.manageWorkspace,
    canManageApiKeys: capabilities.manageApiKeys,
  };
}

export function SettingsPage({ workspace }: { workspace: Workspace }): ReactNode {
  const [apiKey, setApiKey] = useState("");
  const brandQuery = useQuery(emailBrandProfileQueryOptions());
  const permissions = settingsPermissions(workspace.capabilities);

  async function createKey(): Promise<void> {
    const created = await createWorkspaceApiKey();
    setApiKey(created.token);
  }

  return (
    <PageLayout title="設定">
      <div className="grid gap-6 xl:grid-cols-2">
        {brandQuery.data ? (
          <EmailBrandSettings
            key={brandQuery.data.updatedAt ?? "default-brand"}
            profile={brandQuery.data}
            editable={permissions.canEditWorkspace}
          />
        ) : (
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>メールブランド</CardTitle>
              <CardDescription>メール用のブランド情報を読み込んでいます。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        )}
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
            {permissions.canManageApiKeys ? (
              <Button variant="outline" onClick={() => void createKey()}>
                APIキーを作成
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">管理者のみ作成できます。</p>
            )}
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

function EmailBrandSettings({
  profile: initialProfile,
  editable,
}: {
  profile: EmailBrandProfile;
  editable: boolean;
}): ReactNode {
  const updateBrand = useUpdateEmailBrandProfile();
  const { busy, error, run } = useFormSubmission("メールブランドを保存できませんでした");
  const [profile, setProfile] = useState(initialProfile);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await run(async () => {
      const saved = await updateBrand.mutateAsync({
        brandName: profile.brandName,
        companyDescription: profile.companyDescription,
        tone: profile.tone,
        logoAssetId: profile.logoAssetId,
        websiteUrl: profile.websiteUrl,
        primaryColor: profile.primaryColor,
        backgroundColor: profile.backgroundColor,
        textColor: profile.textColor,
        postalAddress: profile.postalAddress,
      });
      setProfile(saved);
      toast.success("メールブランドを保存しました");
    });
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Palette />
          </div>
          <div>
            <CardTitle>メールブランド</CardTitle>
            <CardDescription>
              AIの文体、React Emailのヘッダー・フッター、既定色に利用します。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <FieldGroup className="sm:grid sm:grid-cols-2">
              <FormInput
                label="ブランド名"
                name="brandName"
                value={profile.brandName}
                disabled={!editable}
                maxLength={191}
                required
                onChange={(event) => setProfile({ ...profile, brandName: event.target.value })}
              />
              <FormInput
                label="Webサイト"
                name="websiteUrl"
                type="url"
                value={profile.websiteUrl ?? ""}
                disabled={!editable}
                placeholder="https://example.com"
                onChange={(event) =>
                  setProfile({ ...profile, websiteUrl: event.target.value || null })
                }
              />
            </FieldGroup>
            <FormTextarea
              label="事業・ブランドの説明"
              name="companyDescription"
              value={profile.companyDescription}
              disabled={!editable}
              rows={3}
              maxLength={2_000}
              onChange={(event) =>
                setProfile({ ...profile, companyDescription: event.target.value })
              }
            />
            <FormTextarea
              label="文章トーン"
              name="tone"
              value={profile.tone}
              disabled={!editable}
              rows={2}
              maxLength={1_000}
              placeholder="簡潔で親しみやすく、誇張表現は避ける"
              onChange={(event) => setProfile({ ...profile, tone: event.target.value })}
            />
            <FormTextarea
              label="所在地"
              name="postalAddress"
              value={profile.postalAddress}
              disabled={!editable}
              rows={2}
              maxLength={500}
              description="Marketingテンプレートの公開時に必須で、管理フッターへ表示されます。"
              onChange={(event) => setProfile({ ...profile, postalAddress: event.target.value })}
            />

            <FieldGroup className="sm:grid sm:grid-cols-3">
              <BrandColorInput
                label="メイン色"
                name="primaryColor"
                value={profile.primaryColor}
                disabled={!editable}
                onChange={(primaryColor) => setProfile({ ...profile, primaryColor })}
              />
              <BrandColorInput
                label="背景色"
                name="backgroundColor"
                value={profile.backgroundColor}
                disabled={!editable}
                onChange={(backgroundColor) => setProfile({ ...profile, backgroundColor })}
              />
              <BrandColorInput
                label="文字色"
                name="textColor"
                value={profile.textColor}
                disabled={!editable}
                onChange={(textColor) => setProfile({ ...profile, textColor })}
              />
            </FieldGroup>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <ImageIcon className="text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">メールロゴ</p>
                <p className="truncate text-sm text-muted-foreground">
                  {profile.logoAssetId ?? "ロゴは設定されていません"}
                </p>
              </div>
              {editable ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
                    公開画像から選択
                  </Button>
                  {profile.logoAssetId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setProfile({ ...profile, logoAssetId: null })}
                    >
                      解除
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            {error ? <ErrorAlert>{error}</ErrorAlert> : null}
            {editable ? (
              <LoadingButton type="submit" busy={busy} busyLabel="保存中…" className="self-start">
                メールブランドを保存
              </LoadingButton>
            ) : (
              <p className="text-sm text-muted-foreground">管理者のみ変更できます。</p>
            )}
          </FieldGroup>
        </form>
        <AssetPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(asset) => {
            setProfile({ ...profile, logoAssetId: asset.id });
            setPickerOpen(false);
          }}
        />
      </CardContent>
    </Card>
  );
}

function BrandColorInput({
  label,
  name,
  value,
  disabled,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <FormInput
      label={label}
      name={name}
      type="color"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
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
