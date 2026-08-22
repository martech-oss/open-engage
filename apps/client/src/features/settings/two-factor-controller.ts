import { type FormEvent, useState } from "react";

import { authClient } from "@/auth-client";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";

interface TwoFactorSetup {
  totpURI: string;
  backupCodes: string[];
}

export function useTwoFactorController() {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");

  async function enable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const password = getFormString(new FormData(event.currentTarget), "password");
    setError("");
    try {
      const result = await authClient.twoFactor.enable({ password, issuer: "OpenEngage" });
      if (result.error) {
        setError(result.error.message ?? "TOTPを開始できませんでした");
      } else if (result.data) {
        setSetup(result.data);
      }
    } catch (cause) {
      setError(getErrorMessage(cause, "TOTPを開始できませんでした"));
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code = getFormString(new FormData(event.currentTarget), "code");
    setError("");
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(result.error.message ?? "認証コードを確認できませんでした");
      } else if (result.data) {
        setVerified(true);
      }
    } catch (cause) {
      setError(getErrorMessage(cause, "認証コードを確認できませんでした"));
    }
  }

  return { setup, verified, error, enable, verify };
}
