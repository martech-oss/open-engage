import type { AutomationNode } from "@openengage/core/automations";
import { evaluateSendEligibility } from "@openengage/core/consent";
import { retryDelaySeconds } from "@openengage/core/platform";
import { type AutomationJobRow } from "@openengage/database/automations";
import { createDatabase, type OpenEngageDatabase } from "@openengage/database/client";
import { ConsentRepository } from "@openengage/database/consent";
import {
  DeliveryRecoveryRepository,
  EmailTrackingEventRepository,
  MessagingDeliveryPreparationRepository,
  MessagingDeliveryWriteRepository,
  type DeliveryLeaseRecord,
} from "@openengage/database/messaging";
import { uuidv7 } from "@openengage/database/shared";

import {
  OutboundWebhookAdapter,
  PermanentChannelError,
  RecipientSuppressedChannelError,
  TransientChannelError,
  type ChannelMessage,
} from "../channels";
import { type RuntimeEnv } from "../env";
import { CloudflareEmailAdapter } from "../messaging/cloudflare-email";
import {
  EmailTemplateServiceError,
  resolveEmailRenderOptions,
} from "../messaging/email-template-service";
import { applyEmailTracking } from "../messaging/email-tracking";
import { buildReplyAddress } from "../messaging/reply-address";
import { decryptCredentials } from "../platform/crypto";
import { renderSubject } from "../rendering/content-renderer";
import { renderEmailDocument } from "../rendering/email-renderer";

export type DeliveryRow = DeliveryLeaseRecord;

export async function createEmailDelivery(
  action: Extract<AutomationNode, { type: "action" }>["config"] & {
    action: "send_email";
  },
  job: AutomationJobRow,
  leaseId: string,
  env: RuntimeEnv,
  database: OpenEngageDatabase,
): Promise<void> {
  if (!job.contactEmail) throw new PermanentChannelError("Contact does not have an email");
  const messagingDeliveryPreparation = new MessagingDeliveryPreparationRepository(database),
    messagingDeliveryWrite = new MessagingDeliveryWriteRepository(database);
  const template = await messagingDeliveryPreparation.findSendableTemplate(
    job.workspaceId,
    action.templateId,
  );
  if (!template) throw new PermanentChannelError("Email template is missing");
  const message = await messagingDeliveryPreparation.readMessageVariables(job.workspaceId);
  const workspace = await messagingDeliveryPreparation.readWorkspaceTemplateContext(
    job.workspaceId,
  );
  const contact = {
    email: job.contactEmail,
    first_name: job.firstName,
    last_name: job.lastName,
    phone: job.phone,
    stage: job.stage,
    score: job.score,
    ...job.customFields,
  };
  const deliveryId = uuidv7();
  const renderContext = {
    contact,
    workspace,
    message,
  };
  let renderOptions;
  try {
    renderOptions = await resolveEmailRenderOptions(
      database,
      job.workspaceId,
      env.APP_URL,
      template.content,
      false,
    );
  } catch (error) {
    if (error instanceof EmailTemplateServiceError) {
      throw new PermanentChannelError("Email template references an unavailable image");
    }
    throw error;
  }
  const rendered = await renderEmailDocument(template.content, renderContext, {
    purpose: "transactional",
    ...renderOptions,
  });
  // Only Automation mail reaches this function - Better Auth's own transactional
  // mail is rendered elsewhere - so opt-in open/click measurement applies here
  // and nowhere else. `text` keeps the un-rewritten links on purpose.
  const tracking = await new EmailTrackingEventRepository(database).readSettings(job.workspaceId);
  const html =
    tracking.openTrackingEnabled || tracking.clickTrackingEnabled
      ? await applyEmailTracking(rendered.html, {
          secret: env.TRACKING_SIGNING_SECRET,
          appUrl: env.APP_URL,
          workspaceId: job.workspaceId,
          deliveryId,
          contactId: job.contactId,
          openTracking: tracking.openTrackingEnabled,
          clickTracking: tracking.clickTrackingEnabled,
        })
      : rendered.html;
  const replyTo = await buildReplyAddress(env, job.workspaceId, deliveryId, job.contactId);
  const payload: ChannelMessage = {
    kind: "email",
    idempotencyKey: `${job.idempotencyKey}:email`,
    workspaceId: job.workspaceId,
    deliveryId,
    purpose: "transactional",
    to: job.contactEmail,
    from: senderForPurpose(env, "transactional"),
    replyTo,
    subject: renderSubject(template.subject, renderContext),
    ...rendered,
    html,
  };
  const created = await messagingDeliveryWrite.insertQueuedDelivery(
    {
      id: deliveryId,
      workspaceId: job.workspaceId,
      contactId: job.contactId,
      enrollmentId: job.enrollmentId,
      channel: "email",
      purpose: "transactional",
      provider: "cloudflare",
      recipient: job.contactEmail,
      topicId: action.topicId ?? null,
      templateId: template.id,
      idempotencyKey: payload.idempotencyKey,
      payload: JSON.stringify(payload),
    },
    { jobId: job.id, workspaceId: job.workspaceId, leaseId },
  );
  if (created) {
    await env.DELIVERY_QUEUE.send({ kind: "delivery", deliveryId });
  }
}

export async function createWebhookDelivery(
  endpointId: string,
  job: AutomationJobRow,
  leaseId: string,
  env: RuntimeEnv,
  database: OpenEngageDatabase,
): Promise<void> {
  const messagingDeliveryPreparation = new MessagingDeliveryPreparationRepository(database),
    messagingDeliveryWrite = new MessagingDeliveryWriteRepository(database);
  const endpoint = await messagingDeliveryPreparation.findEnabledWebhookEndpoint(
    job.workspaceId,
    endpointId,
  );
  if (!endpoint) throw new PermanentChannelError("Webhook endpoint is missing");
  const deliveryId = uuidv7();
  const payload: ChannelMessage = {
    kind: "webhook",
    idempotencyKey: `${job.idempotencyKey}:webhook`,
    workspaceId: job.workspaceId,
    deliveryId,
    payload: {
      contactId: job.contactId,
      enrollmentId: job.enrollmentId,
    },
  };
  const created = await messagingDeliveryWrite.insertQueuedDelivery(
    {
      id: deliveryId,
      workspaceId: job.workspaceId,
      contactId: job.contactId,
      enrollmentId: job.enrollmentId,
      channel: "webhook",
      purpose: "transactional",
      provider: "webhook",
      recipient: endpoint.url,
      idempotencyKey: payload.idempotencyKey,
      payload: JSON.stringify({ ...payload, endpointId }),
    },
    { jobId: job.id, workspaceId: job.workspaceId, leaseId },
  );
  if (created) {
    await env.DELIVERY_QUEUE.send({ kind: "delivery", deliveryId });
  }
}

export async function processDelivery(deliveryId: string, env: RuntimeEnv): Promise<void> {
  const database = createDatabase(env.DB);
  const repository = new DeliveryRecoveryRepository(database);
  const delivery = await repository.claimDelivery(deliveryId);
  if (!delivery) return;

  let result: { providerMessageId: string; acceptedAt: string };
  try {
    if (delivery.contactId) {
      const gate = await readConsentGate(delivery, database);
      const decision = evaluateSendEligibility(delivery.purpose, gate);
      if (!decision.allowed) {
        await repository.markSuppressed(delivery.id, delivery.leaseId, decision.reason);
        return;
      }
    }
    const endpointId =
      delivery.payload.kind === "webhook" ? delivery.payload.endpointId : undefined;
    const adapter = await deliveryAdapter(delivery, endpointId, env, database);
    result = await adapter.send(delivery.payload);
  } catch (error) {
    if (error instanceof RecipientSuppressedChannelError) {
      await repository.markProviderSuppressed(delivery.id, delivery.leaseId);
      return;
    }
    const terminal = error instanceof PermanentChannelError || delivery.attempts >= 5;
    const delay = retryDelaySeconds(delivery.attempts);
    await repository.recordFailure(delivery.id, delivery.leaseId, {
      status: terminal ? "failed" : "queued",
      nextAttemptAt: terminal ? null : new Date(Date.now() + delay * 1000).toISOString(),
      lastError:
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    });
    if (!terminal) throw new TransientChannelError("Delivery will be retried");
    return;
  }
  // This write intentionally sits outside the provider-error catch. Once a
  // provider reports success, a database failure is ambiguous and must leave
  // the delivery in `sending` for channel-specific stale recovery.
  await repository.markAccepted({
    deliveryId: delivery.id,
    leaseId: delivery.leaseId,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
  });
}

export async function deliveryAdapter(
  delivery: DeliveryRow,
  endpointId: string | undefined,
  env: RuntimeEnv,
  database: OpenEngageDatabase,
) {
  if (delivery.provider === "cloudflare") {
    if (delivery.purpose !== "transactional") {
      throw new PermanentChannelError("Marketing email is disabled");
    }
    return new CloudflareEmailAdapter(env.EMAIL);
  }
  if (!endpointId) throw new PermanentChannelError("Webhook endpoint is missing");
  const endpoint = await new MessagingDeliveryPreparationRepository(
    database,
  ).findEnabledWebhookEndpointWithSecret(delivery.workspaceId, endpointId);
  if (!endpoint) throw new PermanentChannelError("Webhook endpoint is disabled or missing");
  const secret = await decryptCredentials<{ secret: string }>(
    env.CREDENTIAL_ENCRYPTION_KEY,
    endpoint.encryptedSecret,
  );
  return new OutboundWebhookAdapter({ url: endpoint.url, secret: secret.secret });
}

export function senderForPurpose(
  env: RuntimeEnv,
  purpose: "marketing" | "transactional",
): { email: string; name?: string } {
  if (purpose === "marketing") throw new PermanentChannelError("Marketing email is disabled");
  return { email: env.TRANSACTIONAL_FROM_EMAIL, name: env.TRANSACTIONAL_FROM_NAME };
}

export async function readConsentGate(delivery: DeliveryRow, database: OpenEngageDatabase) {
  const rows = await new ConsentRepository(database, {
    workspaceId: delivery.workspaceId,
  }).readConsentGateRows({
    contactId: delivery.contactId,
    recipient: delivery.recipient,
    topicId: delivery.topicId,
  });
  const topicStatus =
    delivery.topicId && rows.topicStatus
      ? (rows.topicStatus as "subscribed" | "unsubscribed" | "pending")
      : undefined;
  return {
    ...(rows.contactStatus
      ? { contactStatus: rows.contactStatus as "active" | "archived" | "anonymous" }
      : {}),
    globalStatus:
      rows.suppressionReason === "global_unsubscribe"
        ? ("unsubscribed" as const)
        : ("subscribed" as const),
    suppressed: Boolean(rows.suppressionReason),
    ...(topicStatus ? { topicStatus } : {}),
    frequency: {
      sentInWindow: rows.marketingSentInWindow,
      limit: 3,
    },
  };
}
