import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { note, outro } from "@clack/prompts";
import pc from "picocolors";

import { type CommandCheck, commandRunner } from "../command-runner";
import {
  emailSendingEventTypes,
  readConfiguredResources,
  requiredSecretNames,
  serverWrangler,
} from "../provisioning";

const placeholderDatabaseId = "00000000-0000-0000-0000-000000000000";

export async function runDoctorCommand(): Promise<void> {
  const projectDirectory = process.cwd();
  const config = await readFile(resolve(projectDirectory, "apps/server/wrangler.jsonc"), "utf8");
  const resources = readConfiguredResources(config);
  const run = (name: string, args: string[]) =>
    commandRunner.check(name, "pnpm", args, projectDirectory);
  const outputIncludes = (name: string, args: string[], expected: readonly string[]) =>
    commandRunner.outputIncludes(name, "pnpm", args, projectDirectory, expected);
  const checks: CommandCheck[] = [
    await run("Cloudflare login", serverWrangler("whoami")),
    await run("Worker bindings", ["cf:types"]),
    await run(
      "D1 schema",
      serverWrangler(
        "d1",
        "execute",
        resources.database,
        "--remote",
        "--command",
        "SELECT COUNT(*) FROM d1_migrations",
      ),
    ),
    await outputIncludes("Queues", serverWrangler("queues", "list", "--json"), resources.queues),
    await outputIncludes("R2", serverWrangler("r2", "bucket", "list"), [resources.bucket]),
    await outputIncludes("Secrets", serverWrangler("secret", "list"), requiredSecretNames),
    await outputIncludes(
      "Email Sending domain",
      serverWrangler("email", "sending", "list", resources.sendingDomain),
      [resources.sendingDomain],
    ),
    {
      name: "EMAIL binding",
      ok: resources.hasEmailBinding,
      detail: resources.hasEmailBinding
        ? `restricted to ${resources.fromEmail}`
        : "configure EMAIL with allowed_sender_addresses",
    },
    await commandRunner.inspect(
      "Email event subscription",
      "pnpm",
      serverWrangler("queues", "subscription", "list", resources.emailEventsQueue, "--json"),
      projectDirectory,
      (stdout) => {
        const output = stdout.toLowerCase();
        const ok =
          output.includes("email.sending") &&
          output.includes(resources.sendingDomain.toLowerCase()) &&
          emailSendingEventTypes.every((event) => output.includes(event));
        return {
          ok,
          detail: ok
            ? "configured"
            : "subscribe the six Email Sending events in Cloudflare Dashboard",
        };
      },
    ),
    {
      name: "D1 database ID",
      ok: !config.includes(placeholderDatabaseId),
      detail: config.includes(placeholderDatabaseId)
        ? "Replace the placeholder by running create-openengage provisioning"
        : "configured",
    },
  ];
  note(
    checks
      .map((check) => `${check.ok ? pc.green("✓") : pc.red("✗")} ${check.name}: ${check.detail}`)
      .join("\n"),
    "Doctor report",
  );
  if (checks.some((check) => !check.ok)) throw new Error("Doctor found configuration problems");
  outro("All mandatory checks passed");
}
