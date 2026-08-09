import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Blocks, UsersRound } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { authClient } from "@/auth-client";
import { ErrorAlert, FormInput, LoadingButton, SuccessAlert } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { getFormString } from "@/lib/form-data";
import { slugify } from "@/lib/utils";

export function AuthPage({ redirectTo = "/dashboard" }: { redirectTo?: string }): ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);

  async function finishAuthentication(): Promise<void> {
    queryClient.clear();
    await router.invalidate({ sync: true });
    router.history.push(redirectTo);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    const email = getFormString(form, "email");
    const password = getFormString(form, "password");
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: getFormString(form, "name"),
          });
    setBusy(false);

    if (
      mode === "signin" &&
      result.data &&
      "twoFactorRedirect" in result.data &&
      result.data.twoFactorRedirect
    ) {
      setTwoFactorPending(true);
      return;
    }
    if (result.error) {
      setError(result.error.message ?? "認証できませんでした");
      return;
    }
    if (mode === "signup" && !result.data?.token) {
      setMode("signin");
      setNotice("アカウントを作成しました。確認メールのリンクを開いてからログインしてください。");
      return;
    }
    await finishAuthentication();
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="hidden border-r bg-muted/40 p-14 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Blocks />
          </div>
          <span className="font-heading text-xl font-semibold">OpenEngage</span>
        </div>
        <div className="flex flex-col items-start gap-6">
          <Badge variant="outline">Cloudflare-native marketing automation</Badge>
          <h1 className="max-w-2xl font-heading text-5xl leading-[1.08] font-semibold tracking-tight">
            獲得から配信まで、エッジで自動化。
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            D1、Queues、R2、Email Serviceを一つのWorkerに統合した、
            オープンソースのマーケティング基盤です。
          </p>
        </div>
        <div className="flex gap-8 text-sm text-muted-foreground">
          <span>MIT License</span>
          <span>TypeScript</span>
          <span>Cloudflare Workers</span>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 lg:hidden">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Blocks />
              </div>
              <span className="font-heading font-semibold">OpenEngage</span>
            </div>
            <CardTitle className="text-2xl">
              {mode === "signin" ? "おかえりなさい" : "アカウントを作成"}
            </CardTitle>
            <CardDescription>
              {mode === "signin" ? "ワークスペースへログインします。" : "アカウントを作成します。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {twoFactorPending ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const code = getFormString(new FormData(event.currentTarget), "code");
                  setBusy(true);
                  void authClient.twoFactor
                    .verifyTotp({ code, trustDevice: true })
                    .then(async (result) => {
                      if (result.error) {
                        setError(result.error.message ?? "コードが無効です");
                      } else {
                        await finishAuthentication();
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <FieldGroup>
                  <FormInput label="認証アプリの6桁コード" name="code" required />
                  {error ? <ErrorAlert>{error}</ErrorAlert> : null}
                  <LoadingButton busy={busy} className="w-full" type="submit">
                    確認してログイン
                  </LoadingButton>
                </FieldGroup>
              </form>
            ) : (
              <form onSubmit={(event) => void submit(event)}>
                <FieldGroup>
                  {mode === "signup" ? <FormInput label="名前" name="name" required /> : null}
                  <FormInput label="メールアドレス" name="email" type="email" required />
                  <FormInput
                    label="パスワード（12文字以上）"
                    name="password"
                    type="password"
                    minLength={12}
                    required
                  />
                  {notice ? <SuccessAlert>{notice}</SuccessAlert> : null}
                  {error ? <ErrorAlert>{error}</ErrorAlert> : null}
                  <LoadingButton busy={busy} className="w-full" type="submit">
                    {mode === "signin" ? "ログイン" : "登録"}
                  </LoadingButton>
                </FieldGroup>
              </form>
            )}
            <Button
              variant="link"
              className="self-start px-0"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setNotice("");
              }}
            >
              {mode === "signin" ? "新しいアカウントを作成" : "ログインへ戻る"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function WorkspaceSetupPage(): ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = getFormString(new FormData(event.currentTarget), "name");
    setBusy(true);
    setError("");
    const result = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    if (result.error) {
      setError(result.error.message ?? "作成できませんでした");
      setBusy(false);
      return;
    }
    if (result.data?.id) {
      await authClient.organization.setActive({
        organizationId: result.data.id,
      });
    }
    queryClient.clear();
    await router.invalidate({ sync: true });
    await router.navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UsersRound />
          </div>
          <CardTitle className="text-2xl">ワークスペースを作成</CardTitle>
          <CardDescription>OrganizationがOpenEngageのWorkspaceになります。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)}>
            <FieldGroup>
              <FormInput label="ワークスペース名" name="name" required />
              {error ? <ErrorAlert>{error}</ErrorAlert> : null}
              <LoadingButton busy={busy} className="w-full" type="submit">
                作成して開始
              </LoadingButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
