import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";

import { confirm, isCancel, note, outro, password, spinner, text } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

import {
  cloudflareResourceNames,
  initialWorkerDeployCommands,
  rewriteWorkerConfigs,
} from "../provisioning";
import { abort } from "../shared";
import { commandRunner } from "../shared-runner";

export async function runCreateCommand(directoryArgument?: string): Promise<void> {
  const directoryAnswer = await text({
    message: "Project directory",
    placeholder: "openengage",
    defaultValue: directoryArgument ?? "openengage",
    validate: (value) => (!value.trim() ? "Directory is required" : undefined),
  });
  if (isCancel(directoryAnswer)) return abort();
  const appUrlAnswer = await text({
    message: "Production URL",
    placeholder: "https://ma.example.com",
    validate: (value) => {
      try {
        return new URL(value).protocol === "https:" ? undefined : "HTTPS is required";
      } catch {
        return "Enter a valid URL";
      }
    },
  });
  if (isCancel(appUrlAnswer)) return abort();
  const defaultSendingDomain = new URL(String(appUrlAnswer)).hostname;
  const sendingDomainAnswer = await text({
    message: "Cloudflare Email Sending domain",
    placeholder: defaultSendingDomain,
    defaultValue: defaultSendingDomain,
    validate: (value) =>
      /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) ? undefined : "Enter a valid domain",
  });
  if (isCancel(sendingDomainAnswer)) return abort();
  const transactionalFromEmail = await text({
    message: "Transactional from address",
    placeholder: `notifications@${String(sendingDomainAnswer)}`,
    defaultValue: `notifications@${String(sendingDomainAnswer)}`,
    validate: (value) =>
      value.toLowerCase().endsWith(`@${String(sendingDomainAnswer).toLowerCase()}`)
        ? undefined
        : "The address must use the Email Sending domain",
  });
  if (isCancel(transactionalFromEmail)) return abort();
  const transactionalFromName = await text({
    message: "Transactional from name",
    defaultValue: "OpenEngage",
    validate: (value) => (value.trim() ? undefined : "Sender name is required"),
  });
  if (isCancel(transactionalFromName)) return abort();
  const provisionAnswer = await confirm({
    message: "Provision D1, R2, Queues, secrets, migrations, and deploy now?",
    initialValue: true,
  });
  if (isCancel(provisionAnswer)) return abort();
  const projectDirectory = resolve(String(directoryAnswer));
  const progress = spinner();
  progress.start("Preparing source");
  if (!(await exists(resolve(projectDirectory, "apps/server/wrangler.jsonc")))) {
    const source = process.env["OPENENGAGE_TEMPLATE_DIR"];
    if (source) {
      await mkdir(projectDirectory, { recursive: true });
      await cp(resolve(source), projectDirectory, { recursive: true });
    } else {
      const repository =
        process.env["OPENENGAGE_TEMPLATE_REPOSITORY"] ??
        "https://github.com/martech-oss/openengage.git";
      await execa("git", ["clone", "--depth=1", repository, projectDirectory]);
    }
  }
  await execa("pnpm", ["install"], { cwd: projectDirectory });
  progress.stop("Source is ready");
  if (!provisionAnswer) {
    outro(`Run ${pc.cyan("npx create-openengage doctor")} from the project when ready.`);
    return;
  }
  await provision(projectDirectory, String(appUrlAnswer), {
    sendingDomain: String(sendingDomainAnswer),
    fromEmail: String(transactionalFromEmail),
    fromName: String(transactionalFromName),
  });
  outro(`OpenEngage deployed from ${pc.cyan(projectDirectory)}`);
}

async function provision(
  projectDirectory: string,
  appUrl: string,
  email: { sendingDomain: string; fromEmail: string; fromName: string },
): Promise<void> {
  const projectName = slugify(basename(projectDirectory));
  const resources = cloudflareResourceNames(projectName);
  const turnstileSiteKey = await text({
    message: "Turnstile site key (optional)",
    placeholder: "0x4AAAA...",
  });
  if (isCancel(turnstileSiteKey)) return abort();
  await execa("pnpm", ["--filter", "@openengage/server", "exec", "wrangler", "whoami"], {
    cwd: projectDirectory,
  });
  await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "email",
      "sending",
      "enable",
      email.sendingDomain,
    ],
    { cwd: projectDirectory },
  );
  const d1 = await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "d1",
      "create",
      resources.database,
      "--json",
    ],
    { cwd: projectDirectory },
  );
  const d1Payload = JSON.parse(d1.stdout) as { uuid?: string } | Array<{ uuid?: string }>;
  const databaseId = Array.isArray(d1Payload) ? d1Payload[0]?.uuid : d1Payload.uuid;
  if (!databaseId) throw new Error("Wrangler did not return a D1 database ID");
  await runAllowExisting(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "create",
      resources.bucket,
    ],
    projectDirectory,
  );
  for (const queueName of Object.values(resources.queues)) {
    await runAllowExisting(
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "queues", "create", queueName],
      projectDirectory,
    );
  }
  const serverConfigPath = resolve(projectDirectory, "apps/server/wrangler.jsonc");
  const clientConfigPath = resolve(projectDirectory, "apps/client/wrangler.jsonc");
  const agentConfigPath = resolve(projectDirectory, "apps/agent/wrangler.jsonc");
  const workerConfigs = rewriteWorkerConfigs({
    projectName,
    appUrl,
    databaseId,
    transactionalFromEmail: email.fromEmail,
    transactionalFromName: email.fromName,
    turnstileSiteKey: String(turnstileSiteKey),
    server: await readFile(serverConfigPath, "utf8"),
    agent: await readFile(agentConfigPath, "utf8"),
    client: await readFile(clientConfigPath, "utf8"),
  });
  await Promise.all([
    writeFile(serverConfigPath, workerConfigs.server),
    writeFile(agentConfigPath, workerConfigs.agent),
    writeFile(clientConfigPath, workerConfigs.client),
  ]);

  const betterAuthSecret = randomSecret();
  const encryptionKey = randomSecret();
  const trackingSecret = randomSecret();
  await putSecret(projectDirectory, "BETTER_AUTH_SECRET", betterAuthSecret);
  await putSecret(projectDirectory, "CREDENTIAL_ENCRYPTION_KEY", encryptionKey);
  await putSecret(projectDirectory, "TRACKING_SIGNING_SECRET", trackingSecret);
  const turnstile = await password({ message: "Turnstile secret (optional)", mask: "•" });
  if (!isCancel(turnstile) && turnstile) {
    await putSecret(projectDirectory, "TURNSTILE_SECRET", String(turnstile));
  }
  const progress = spinner();
  progress.start("Applying migrations and deploying");
  await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      resources.database,
      "--remote",
    ],
    { cwd: projectDirectory, input: "y\n" },
  );
  // Create the private Agent Worker without its reverse binding first. This
  // breaks the Agent <-> Server service-binding cycle on a fresh account.
  for (const args of initialWorkerDeployCommands) {
    await execa("pnpm", [...args], { cwd: projectDirectory });
  }
  progress.stop("Infrastructure and Workers are ready");
  note(
    `Cloudflare DashboardでQueue ${resources.queues.emailEvents}へEmail Sending (${email.sendingDomain}) の delivered, deferred, bounced, failed, rejected, complained を購読してください。完了後に create-openengage doctor を実行してください。`,
    "Email event subscription required",
  );
}

async function putSecret(directory: string, name: string, value: string): Promise<void> {
  await execa(
    "pnpm",
    ["--filter", "@openengage/server", "exec", "wrangler", "secret", "put", name],
    {
      cwd: directory,
      input: value,
    },
  );
}

async function runAllowExisting(file: string, args: string[], cwd: string): Promise<void> {
  await commandRunner.allowExisting(file, args, cwd);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "openengage"
  );
}
