import { type FormEvent, useState } from "react";

import { authClient } from "@/auth-client";
import { getFormString } from "@/lib/form-data";

interface TwoFactorSetup {
  totpURI: string;
  backupCodes: string[];
}

export function useTwoFactorController() {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [verified, setVerified] = useState(false);

  async function enable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const password = getFormString(new FormData(event.currentTarget), "password");
    const result = await authClient.twoFactor.enable({ password, issuer: "OpenEngage" });
    if (result.data) setSetup(result.data);
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code = getFormString(new FormData(event.currentTarget), "code");
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.data) setVerified(true);
  }

  return { setup, verified, enable, verify };
}
