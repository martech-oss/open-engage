import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { isCancel, outro, text } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

import { readConfiguredResources } from "../provisioning";
import { abort } from "../shared";

export async function runBackupCommand(): Promise<void> {
  const outputAnswer = await text({
    message: "Backup file",
    defaultValue: `backups/openengage-${new Date().toISOString().slice(0, 10)}.sql`,
  });
  if (isCancel(outputAnswer)) return abort();
  const output = resolve(String(outputAnswer));
  const serverConfig = await readFile(resolve(process.cwd(), "apps/server/wrangler.jsonc"), "utf8");
  const databaseName = readConfiguredResources(serverConfig).database;
  await mkdir(resolve(output, ".."), { recursive: true });
  await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "d1",
      "export",
      databaseName,
      "--remote",
      "--output",
      output,
    ],
    { cwd: process.cwd(), stdio: "inherit" },
  );
  outro(`D1 backup written to ${pc.cyan(output)}. R2 objects remain versioned in the bucket.`);
}
