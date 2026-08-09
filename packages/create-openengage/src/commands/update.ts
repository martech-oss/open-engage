import process from "node:process";

import { confirm, isCancel, outro } from "@clack/prompts";
import { execa } from "execa";

import { abort } from "../shared";

export async function runUpdateCommand(): Promise<void> {
  const approved = await confirm({
    message: "Pull changes, install dependencies, apply remote migrations, and deploy?",
    initialValue: false,
  });
  if (isCancel(approved) || !approved) return abort();
  await execa("git", ["pull", "--ff-only"], { cwd: process.cwd(), stdio: "inherit" });
  await execa("pnpm", ["install"], { cwd: process.cwd(), stdio: "inherit" });
  await execa("pnpm", ["db:migrate:remote"], {
    cwd: process.cwd(),
    input: "y\n",
    stdio: ["pipe", "inherit", "inherit"],
  });
  await execa("pnpm", ["deploy"], { cwd: process.cwd(), stdio: "inherit" });
  outro("OpenEngage updated");
}
