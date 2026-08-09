import process from "node:process";

import { cancel, intro } from "@clack/prompts";
import pc from "picocolors";

import { runBackupCommand } from "./commands/backup";
import { runCreateCommand } from "./commands/create";
import { runDoctorCommand } from "./commands/doctor";
import { runAddDomainCommand } from "./commands/domain";
import { runUpdateCommand } from "./commands/update";

export type CliCommand =
  | { kind: "create"; directoryArgument?: string }
  | { kind: "doctor" }
  | { kind: "update" }
  | { kind: "backup" }
  | { kind: "domain_add" };

export function resolveCliCommand(args: string[]): CliCommand {
  const command = args[0] ?? "create";
  if (command === "doctor") return { kind: "doctor" };
  if (command === "update") return { kind: "update" };
  if (command === "backup") return { kind: "backup" };
  if (command === "domain" && args[1] === "add") return { kind: "domain_add" };
  return command === "create" ? { kind: "create" } : { kind: "create", directoryArgument: command };
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  intro(pc.bgMagenta(pc.white(" OpenEngage ")));

  try {
    const command = resolveCliCommand(args);
    switch (command.kind) {
      case "doctor":
        await runDoctorCommand();
        break;
      case "update":
        await runUpdateCommand();
        break;
      case "backup":
        await runBackupCommand();
        break;
      case "domain_add":
        await runAddDomainCommand();
        break;
      case "create":
        await runCreateCommand(command.directoryArgument);
        break;
    }
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
