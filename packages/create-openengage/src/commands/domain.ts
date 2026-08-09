import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { isCancel, outro, text } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

import { abort } from "../shared";

export async function runAddDomainCommand(): Promise<void> {
  const domainAnswer = await text({
    message: "Custom domain",
    placeholder: "ma.example.com",
    validate: (value) =>
      /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) ? undefined : "Enter a hostname",
  });
  if (isCancel(domainAnswer)) return abort();
  const configPath = resolve(process.cwd(), "apps/client/wrangler.jsonc");
  let config = await readFile(configPath, "utf8");
  if (!config.includes('"routes"')) {
    config = config.replace(
      '"workers_dev": true,',
      `"workers_dev": true,\n  "routes": [{ "pattern": "${String(domainAnswer)}", "custom_domain": true }],`,
    );
    await writeFile(configPath, config);
  }
  await execa("pnpm", ["deploy"], { cwd: process.cwd(), stdio: "inherit" });
  outro(`Custom domain ${pc.cyan(String(domainAnswer))} deployed`);
}
