import { getContractRouter, isContractProcedure } from "@orpc/contract";

import { contract } from "@openengage/orpc";

import { readFixture } from "./fixture-data";

export const missingFixtures = new Set<string>();
export const previewWriteMessage = "表示確認用プレビューでは保存・公開・外部送信を実行できません。";

/** A read is whatever the contract serves over GET; anything else would write in the real app. */
function isRead(path: readonly string[]): boolean {
  const procedure = getContractRouter(contract, path);
  return isContractProcedure(procedure) && procedure["~orpc"].route.method === "GET";
}
function read(path: string, input: unknown) {
  try {
    return readFixture(path, input);
  } catch (error) {
    missingFixtures.add(path);
    throw error;
  }
}
function proxy(path: string[] = []): any {
  return new Proxy(() => {}, {
    get: (_, key: string) => {
      if (key === "then") return undefined;
      if (key === "queryOptions")
        return (options: any = {}) => ({
          ...options,
          queryKey: [...path, options.input],
          staleTime: Infinity,
          queryFn: async () => {
            if (new URLSearchParams(location.search).get("state") === "error")
              throw new Error("サンプルデータの取得失敗");
            return read(path.join("."), options.input);
          },
        });
      if (key === "mutationOptions")
        return (options: any = {}) => ({
          ...options,
          mutationFn: async () => {
            throw new Error(previewWriteMessage);
          },
        });
      if (key === "key") return () => path;
      return proxy([...path, key]);
    },
    apply: (_target, _this, args) =>
      Promise.resolve().then(() => {
        if (!isRead(path)) throw new Error(previewWriteMessage);
        return read(path.join("."), args[0]);
      }),
  });
}
export const orpcQuery = proxy();
export const orpc = proxy();
