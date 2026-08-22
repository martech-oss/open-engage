import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import { FormInput, SuccessAlert } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

import { useTwoFactorController } from "./two-factor-controller";

export function TwoFactorPanel(): ReactNode {
  const controller = useTwoFactorController();

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
        {!controller.setup ? (
          <form onSubmit={(event) => void controller.enable(event)}>
            <FieldGroup>
              <FormInput label="現在のパスワード" name="password" type="password" required />
              <Button variant="outline" type="submit">
                セットアップを開始
              </Button>
            </FieldGroup>
          </form>
        ) : controller.verified ? (
          <SuccessAlert>
            TOTPを有効にしました。バックアップコードを安全に保管してください。
          </SuccessAlert>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg bg-muted p-3 font-mono text-xs break-all">
              {controller.setup.totpURI}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {controller.setup.backupCodes.join("\n")}
            </pre>
            <form onSubmit={(event) => void controller.verify(event)}>
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
