import { ImageIcon, Palette } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorAlert, FormInput, FormTextarea, LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { AssetPickerDialog } from "@/features/assets/asset-picker";
import type { EmailBrandProfile } from "@/features/emails/email-api";

import { useBrandPanelController } from "./brand-panel-controller";

export function BrandPanel({
  profile: initialProfile,
  editable,
}: {
  profile: EmailBrandProfile;
  editable: boolean;
}): ReactNode {
  const { profile, setProfile, pickerOpen, setPickerOpen, submit, busy, error } =
    useBrandPanelController(initialProfile);

  return (
    <Card className="xl:col-span-2">
      <BrandPanelHeader />
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
            <BrandLogoSelector
              profile={profile}
              editable={editable}
              pickerOpen={pickerOpen}
              setPickerOpen={setPickerOpen}
              setProfile={setProfile}
            />
            {error ? <ErrorAlert>{error}</ErrorAlert> : null}
            {editable ? (
              <LoadingButton type="submit" busy={busy} busyLabel="保存中…" className="self-start">
                ブランドを保存
              </LoadingButton>
            ) : (
              <p className="text-sm text-muted-foreground">管理者のみ変更できます。</p>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function BrandPanelHeader(): ReactNode {
  return (
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
          <Palette />
        </div>
        <div>
          <CardTitle>ワークスペースのブランド</CardTitle>
          <CardDescription>
            LPやメールのAI生成で、文体・ロゴ・色を共通して利用します。
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  );
}

function BrandLogoSelector({
  profile,
  editable,
  pickerOpen,
  setPickerOpen,
  setProfile,
}: {
  profile: EmailBrandProfile;
  editable: boolean;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  setProfile: (profile: EmailBrandProfile) => void;
}): ReactNode {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        <ImageIcon className="text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">ブランドロゴ</p>
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
      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(asset) => {
          setProfile({ ...profile, logoAssetId: asset.id });
          setPickerOpen(false);
        }}
      />
    </>
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
