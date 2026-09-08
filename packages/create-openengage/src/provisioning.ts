export interface WorkerConfigInput {
  projectName: string;
  appUrl: string;
  databaseId: string;
  transactionalFromEmail: string;
  transactionalFromName: string;
  turnstileSiteKey: string;
  server: string;
  agent: string;
  client: string;
}

export function cloudflareResourceNames(projectName: string) {
  return {
    database: `${projectName}-db`,
    bucket: `${projectName}-assets`,
    queues: {
      programMemberImport: `${projectName}-program-member-import`,
      jobs: `${projectName}-jobs`,
      delivery: `${projectName}-delivery`,
      deadLetter: `${projectName}-dead-letter`,
      emailEvents: `${projectName}-email-events`,
    },
  } as const;
}

export function readConfiguredResources(serverConfig: string) {
  const database = serverConfig.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1] ?? "";
  const fromEmail = serverConfig.match(/"TRANSACTIONAL_FROM_EMAIL"\s*:\s*"([^"]+)"/)?.[1] ?? "";
  const emailEventsQueue = serverConfig.match(/"queue"\s*:\s*"([^"]+-email-events)"/)?.[1] ?? "";
  return {
    database,
    fromEmail,
    sendingDomain: fromEmail.split("@")[1] ?? "",
    emailEventsQueue,
    hasEmailBinding:
      /"send_email"\s*:/.test(serverConfig) &&
      /"name"\s*:\s*"EMAIL"/.test(serverConfig) &&
      /"allowed_sender_addresses"\s*:/.test(serverConfig),
  };
}

export function rewriteWorkerConfigs(input: WorkerConfigInput): {
  server: string;
  agent: string;
  client: string;
} {
  const { projectName } = input;
  const resources = cloudflareResourceNames(projectName);
  return {
    server: input.server
      .replaceAll('"name": "openengage-server"', `"name": "${projectName}-server"`)
      .replaceAll('"service": "openengage-agent"', `"service": "${projectName}-agent"`)
      .replaceAll('"database_name": "openengage-db"', `"database_name": "${resources.database}"`)
      .replaceAll("00000000-0000-0000-0000-000000000000", input.databaseId)
      .replaceAll("openengage-assets", resources.bucket)
      .replaceAll("openengage-program-member-import", resources.queues.programMemberImport)
      .replaceAll("openengage-jobs", resources.queues.jobs)
      .replaceAll("openengage-delivery", resources.queues.delivery)
      .replaceAll("openengage-dead-letter", resources.queues.deadLetter)
      .replaceAll("openengage-email-events", resources.queues.emailEvents)
      .replaceAll("notifications@example.com", input.transactionalFromEmail)
      .replaceAll(
        '"TRANSACTIONAL_FROM_NAME": "OpenEngage"',
        `"TRANSACTIONAL_FROM_NAME": ${JSON.stringify(input.transactionalFromName)}`,
      )
      .replaceAll(
        '"TURNSTILE_SITE_KEY": ""',
        `"TURNSTILE_SITE_KEY": ${JSON.stringify(input.turnstileSiteKey)}`,
      )
      .replaceAll('"APP_URL": "http://localhost:5173"', `"APP_URL": "${input.appUrl}"`),
    agent: input.agent
      .replaceAll('"name": "openengage-agent"', `"name": "${projectName}-agent"`)
      .replaceAll('"service": "openengage-server"', `"service": "${projectName}-server"`),
    client: input.client
      .replaceAll('"name": "openengage"', `"name": "${projectName}"`)
      .replaceAll('"service": "openengage-server"', `"service": "${projectName}-server"`),
  };
}

export const initialWorkerDeployCommands = [
  ["--filter", "@openengage/agent", "deploy:bootstrap"],
  ["deploy"],
] as const;
