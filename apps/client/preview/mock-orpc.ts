import { readFixture } from "./fixture-data";

export const missingFixtures = new Set<string>();
export const previewWriteMessage = "表示確認用プレビューでは保存・公開・外部送信を実行できません。";
const isRead = (path: string) =>
  /(?:^|\.)(?:get[A-Z]?|list[A-Z]?|options|bootstrap|profile|programCatalog|programGet|programCohort|memberList|briefList|briefOptions|variablesList|variablesUses|executionOptions|enrichmentCapability|notifications|salesMembers|assignmentGroups|contactTasks)/.test(
    path,
  ) || path.startsWith("reports.");
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
        const name = path.join(".");
        if (!isRead(name)) throw new Error(previewWriteMessage);
        return read(name, args[0]);
      }),
  });
}
export const orpcQuery = proxy();
export const orpc = proxy();
