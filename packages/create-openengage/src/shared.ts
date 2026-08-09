import process from "node:process";

import { cancel } from "@clack/prompts";

export function abort(): never {
  cancel("Cancelled");
  process.exit(0);
}
