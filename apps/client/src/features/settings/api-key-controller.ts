import { useState } from "react";

import { createWorkspaceApiKey } from "./settings-api";

type CreateApiKey = () => Promise<{ token: string }>;

export function useApiKeyController(createApiKey: CreateApiKey = createWorkspaceApiKey) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(): Promise<void> {
    setToken("");
    setError("");
    setBusy(true);
    try {
      const created = await createApiKey();
      setToken(created.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "APIキーを作成できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return { token, busy, error, create };
}
