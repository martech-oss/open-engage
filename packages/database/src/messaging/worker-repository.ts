import { DatabaseRepository } from "../shared/repository-base";
import { MessagingDeliveryPreparationRepository } from "./delivery-preparation-repository";
import { MessagingDeliveryWriteRepository } from "./delivery-write-repository";
import { MessagingInboundReplyRepository } from "./inbound-reply-repository";
import { MessagingProviderEventRepository } from "./provider-event-repository";

/** Compatibility facade for queue workers and webhook handlers. */
export class MessagingWorkerRepository extends DatabaseRepository {
  private readonly preparation = new MessagingDeliveryPreparationRepository(this.database);
  private readonly deliveryWrite = new MessagingDeliveryWriteRepository(this.database);
  private readonly inbound = new MessagingInboundReplyRepository(this.database);
  private readonly providerEvents = new MessagingProviderEventRepository(this.database);

  public findSendableTemplate(
    ...args: Parameters<MessagingDeliveryPreparationRepository["findSendableTemplate"]>
  ) {
    return this.preparation.findSendableTemplate(...args);
  }

  public readMessageVariables(
    ...args: Parameters<MessagingDeliveryPreparationRepository["readMessageVariables"]>
  ) {
    return this.preparation.readMessageVariables(...args);
  }

  public readWorkspaceTemplateContext(
    ...args: Parameters<MessagingDeliveryPreparationRepository["readWorkspaceTemplateContext"]>
  ) {
    return this.preparation.readWorkspaceTemplateContext(...args);
  }

  public findEnabledWebhookEndpoint(
    ...args: Parameters<MessagingDeliveryPreparationRepository["findEnabledWebhookEndpoint"]>
  ) {
    return this.preparation.findEnabledWebhookEndpoint(...args);
  }

  public findEnabledWebhookEndpointWithSecret(
    ...args: Parameters<
      MessagingDeliveryPreparationRepository["findEnabledWebhookEndpointWithSecret"]
    >
  ) {
    return this.preparation.findEnabledWebhookEndpointWithSecret(...args);
  }

  public insertQueuedDelivery(
    ...args: Parameters<MessagingDeliveryWriteRepository["insertQueuedDelivery"]>
  ) {
    return this.deliveryWrite.insertQueuedDelivery(...args);
  }

  public findReplyDelivery(
    ...args: Parameters<MessagingInboundReplyRepository["findReplyDelivery"]>
  ) {
    return this.inbound.findReplyDelivery(...args);
  }

  public recordInboundReply(
    ...args: Parameters<MessagingInboundReplyRepository["recordInboundReply"]>
  ) {
    return this.inbound.recordInboundReply(...args);
  }

  public applyCloudflareDeliveryEvent(
    ...args: Parameters<MessagingProviderEventRepository["applyCloudflareDeliveryEvent"]>
  ) {
    return this.providerEvents.applyCloudflareDeliveryEvent(...args);
  }

  public findDeliveryContactId(
    ...args: Parameters<MessagingProviderEventRepository["findDeliveryContactId"]>
  ) {
    return this.providerEvents.findDeliveryContactId(...args);
  }
}
