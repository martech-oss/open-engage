import { BatchLinkPlugin } from "@orpc/client/plugins";
import {
  TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL,
  type TanstackQueryOperationContext,
} from "@orpc/tanstack-query";

const FILE_PROCEDURES = new Set(["assets.download", "contacts.downloadExport"]);

export function rpcRequestMethod(context: TanstackQueryOperationContext): "GET" | "POST" {
  return context[TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]?.type === "query" ? "GET" : "POST";
}

export function createRpcBatchPlugin() {
  return new BatchLinkPlugin({
    groups: [
      {
        condition: ({ request }) => request.method === "GET",
        context: {},
      },
    ],
    maxSize: 10,
    url: ([first]) => {
      const url = new URL(first.request.url);
      const path = url.pathname.split("/");
      path.splice(Math.max(1, path.length - first.path.length), first.path.length);
      url.pathname = `${path.join("/").replace(/\/$/, "")}/__batch__`;
      url.search = "";
      return url;
    },
    exclude: ({ path }) => {
      const procedure = path.join(".");
      const leaf = path.at(-1)?.toLowerCase() ?? "";
      return FILE_PROCEDURES.has(procedure) || leaf.includes("download") || leaf.includes("stream");
    },
  });
}
