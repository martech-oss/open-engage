import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { note, outro } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

import { readConfiguredResources } from "../provisioning";
import { commandRunner } from "../shared-runner";

export async function runDoctorCommand(): Promise<void> {
  const projectDirectory = process.cwd();
  const config = await readFile(resolve(projectDirectory, "apps/server/wrangler.jsonc"), "utf8");
  const resources = readConfiguredResources(config);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push(
    await commandCheck(
      "Cloudflare login",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "whoami"],
      projectDirectory,
    ),
  );
  checks.push(await commandCheck("Worker bindings", "pnpm", ["cf:types"], projectDirectory));
  checks.push(
    await commandCheck(
      "D1 schema",
      "pnpm",
      [
        "--filter",
        "@openengage/server",
        "exec",
        "wrangler",
        "d1",
        "execute",
        resources.database,
        "--remote",
        "--command",
        "SELECT COUNT(*) FROM d1_migrations",
      ],
      projectDirectory,
    ),
  );
  checks.push(
    await commandOutputIncludesCheck(
      "Queues",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "queues", "list", "--json"],
      projectDirectory,
      resources.emailEventsQueue,
    ),
  );
  checks.push(
    await commandCheck(
      "R2",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "r2", "bucket", "list"],
      projectDirectory,
    ),
  );
  checks.push(
    await commandCheck(
      "Secrets",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "secret", "list"],
      projectDirectory,
    ),
  );
  checks.push(
    await commandOutputIncludesCheck(
      "Email Sending domain",
      "pnpm",
      [
        "--filter",
        "@openengage/server",
        "exec",
        "wrangler",
        "email",
        "sending",
        "list",
        resources.sendingDomain,
      ],
      projectDirectory,
      resources.sendingDomain,
    ),
  );
  checks.push({
    name: "EMAIL binding",
    ok: resources.hasEmailBinding,
    detail: resources.hasEmailBinding
      ? `restricted to ${resources.fromEmail}`
      : "configure EMAIL with allowed_sender_addresses",
  });
  checks.push(
    await emailEventSubscriptionCheck(
      projectDirectory,
      resources.emailEventsQueue,
      resources.sendingDomain,
    ),
  );
  checks.push({
    name: "D1 database ID",
    ok: !config.includes("00000000-0000-0000-0000-000000000000"),
    detail: config.includes("00000000-0000-0000-0000-000000000000")
      ? "Replace the placeholder by running create-openengage provisioning"
      : "configured",
  });
  note(
    checks
      .map((check) => `${check.ok ? pc.green("✓") : pc.red("✗")} ${check.name}: ${check.detail}`)
      .join("\n"),
    "Doctor report",
  );
  if (checks.some((check) => !check.ok)) throw new Error("Doctor found configuration problems");
  outro("All mandatory checks passed");
}

async function commandCheck(
  name: string,
  file: string,
  args: string[],
  cwd: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  return commandRunner.check(name, file, args, cwd);
}

async function commandOutputIncludesCheck(
  name: string,
  file: string,
  args: string[],
  cwd: string,
  expected: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  return commandRunner.outputIncludes(name, file, args, cwd, expected);
}

async function emailEventSubscriptionCheck(
  cwd: string,
  queueName: string,
  sendingDomain: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  const required = ["delivered", "deferred", "bounced", "failed", "rejected", "complained"];
  try {
    const result = await execa(
      "pnpm",
      [
        "--filter",
        "@openengage/server",
        "exec",
        "wrangler",
        "queues",
        "subscription",
        "list",
        queueName,
        "--json",
      ],
      { cwd },
    );
    const output = result.stdout.toLowerCase();
    const ok =
      output.includes("email.sending") &&
      output.includes(sendingDomain.toLowerCase()) &&
      required.every((event) => output.includes(event));
    return {
      name: "Email event subscription",
      ok,
      detail: ok ? "configured" : "subscribe the six Email Sending events in Cloudflare Dashboard",
    };
  } catch (error) {
    return {
      name: "Email event subscription",
      ok: false,
      detail: error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    };
  }
}
