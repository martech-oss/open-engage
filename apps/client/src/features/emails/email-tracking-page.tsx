import { useSuspenseQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert, LoadingButton, PageLayout } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  emailTrackingSettingsQueryOptions,
  useUpdateEmailTrackingSettings,
} from "@/features/emails/email-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";

export function EmailTrackingPage(): ReactNode {
  const { data } = useSuspenseQuery(emailTrackingSettingsQueryOptions());
  const [openTrackingEnabled, setOpenTracking] = useState(data.openTrackingEnabled);
  const [clickTrackingEnabled, setClickTracking] = useState(data.clickTrackingEnabled);
  const { busy, error, run } = useFormSubmission("設定を保存できませんでした");
  const updateSettings = useUpdateEmailTrackingSettings();

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await run(async () => {
      await updateSettings.mutateAsync({ openTrackingEnabled, clickTrackingEnabled });
      toast.success("メール計測設定を保存しました");
    });
  }

  return (
    <PageLayout title="メール計測">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>計測設定</CardTitle>
            <CardDescription>
              オートメーションから送信するメールにのみ適用されます。
              {data.updatedAt ? `最終更新: ${formatDateTime(data.updatedAt)}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void save(event)}>
              <FieldGroup>
                <Field orientation="horizontal">
                  <Switch
                    id="open-tracking-enabled"
                    checked={openTrackingEnabled}
                    onCheckedChange={setOpenTracking}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="open-tracking-enabled">
                      <FieldTitle>開封計測</FieldTitle>
                      <FieldDescription>
                        本文末尾に1×1ピクセルの画像を埋め込み、読み込みを開封として記録します。
                      </FieldDescription>
                    </FieldLabel>
                  </FieldContent>
                </Field>
                <Field orientation="horizontal">
                  <Switch
                    id="click-tracking-enabled"
                    checked={clickTrackingEnabled}
                    onCheckedChange={setClickTracking}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="click-tracking-enabled">
                      <FieldTitle>クリック計測</FieldTitle>
                      <FieldDescription>
                        本文中のリンクを計測用URLに書き換えます。配信停止・配信設定リンクは書き換えません。
                      </FieldDescription>
                    </FieldLabel>
                  </FieldContent>
                </Field>
                {error ? <ErrorAlert>{error}</ErrorAlert> : null}
                <LoadingButton busy={busy} type="submit">
                  設定を保存
                </LoadingButton>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Alert>
            <Info />
            <AlertTitle>計測できるもの・できないもの</AlertTitle>
            <AlertDescription>
              計測した開封・クリックはレポートの開封率／クリック率と、オートメーションの分岐
              （開封待ち・クリック待ち）に反映されます。
              プレーンテキスト版のリンクは書き換えないため、HTMLを表示しない受信者のクリックは記録されません。
            </AlertDescription>
          </Alert>
          <Alert>
            <Info />
            <AlertTitle>数値の読み方に注意してください</AlertTitle>
            <AlertDescription>
              Apple Mail
              のプライバシー保護は受信時に画像を先読みするため、開封数は実際より多くなります。
              また企業のリンク検査によって、人が押していないクリックが記録される場合があります。
              同一配信の重複は除外していますが、これらの過大計上は完全には避けられません。
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </PageLayout>
  );
}
