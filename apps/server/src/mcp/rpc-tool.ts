import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import { jsonResult } from "./result";

interface RpcToolOptions {
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  /** Object representation for MCP discovery when the contract uses an intersection. */
  inputSchema?: z.ZodType;
}

/** Keep validation and execution in the public API, including role guards and side effects. */
export function registerRpcTool<Input>(
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodType<Input> | undefined,
  invoke: (input: Input) => Promise<unknown>,
  options: RpcToolOptions = {},
): void {
  server.registerTool(
    name,
    {
      title: name.replaceAll("_", " "),
      description,
      inputSchema: options.inputSchema ?? schema ?? z.object({}),
      annotations: {
        readOnlyHint: options.readOnly ?? false,
        destructiveHint: options.destructive ?? false,
        idempotentHint: options.idempotent ?? options.readOnly ?? false,
        openWorldHint: options.openWorld ?? false,
      },
    },
    async (input: unknown) => {
      try {
        // A contract without an input schema has a void input. All other inputs
        // are parsed with the original schema, including cross-field refinements.
        return jsonResult(
          await invoke(schema ? await schema.parseAsync(input) : (undefined as Input)),
        );
      } catch (error) {
        if (!(error instanceof ORPCError)) throw error;
        return {
          ...jsonResult({ code: error.code, status: error.status, message: error.message }),
          isError: true,
        };
      }
    },
  );
}
