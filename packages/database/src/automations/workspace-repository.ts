import { WorkspaceRepository } from "../shared/repository-base";
import { AutomationEnrollmentRepository } from "./enrollment-repository";
import { AutomationCommandRepository } from "./workspace-command-repository";
import { AutomationQueryRepository } from "./workspace-query-repository";

export type { AutomationAnalyticsRows } from "./workspace-query-repository";

/** Compatibility facade over focused automation repositories. */
export class AutomationRepository extends WorkspaceRepository {
  private readonly queries = new AutomationQueryRepository(this.database, this.context);
  private readonly commands = new AutomationCommandRepository(this.database, this.context);
  private readonly enrollments = new AutomationEnrollmentRepository(this.database, this.context);

  public analytics(...args: Parameters<AutomationQueryRepository["analytics"]>) {
    return this.queries.analytics(...args);
  }
  public listAutomationsWithCounts(
    ...args: Parameters<AutomationQueryRepository["listAutomationsWithCounts"]>
  ) {
    return this.queries.listAutomationsWithCounts(...args);
  }
  public createAutomation(...args: Parameters<AutomationCommandRepository["createAutomation"]>) {
    return this.commands.createAutomation(...args);
  }
  public getDraft(...args: Parameters<AutomationQueryRepository["getDraft"]>) {
    return this.queries.getDraft(...args);
  }
  public saveDraft(...args: Parameters<AutomationCommandRepository["saveDraft"]>) {
    return this.commands.saveDraft(...args);
  }
  public findPublishableDraft(
    ...args: Parameters<AutomationQueryRepository["findPublishableDraft"]>
  ) {
    return this.queries.findPublishableDraft(...args);
  }
  public listPublishedTemplateIds(
    ...args: Parameters<AutomationQueryRepository["listPublishedTemplateIds"]>
  ) {
    return this.queries.listPublishedTemplateIds(...args);
  }
  public publishDraft(...args: Parameters<AutomationCommandRepository["publishDraft"]>) {
    return this.commands.publishDraft(...args);
  }
  public setAutomationStatus(
    ...args: Parameters<AutomationCommandRepository["setAutomationStatus"]>
  ) {
    return this.commands.setAutomationStatus(...args);
  }
  public listActiveTriggersForEvent(
    ...args: Parameters<AutomationEnrollmentRepository["listActiveTriggersForEvent"]>
  ) {
    return this.enrollments.listActiveTriggersForEvent(...args);
  }
  public findActivePublishedAutomation(
    ...args: Parameters<AutomationEnrollmentRepository["findActivePublishedAutomation"]>
  ) {
    return this.enrollments.findActivePublishedAutomation(...args);
  }
  public enrollContact(...args: Parameters<AutomationEnrollmentRepository["enrollContact"]>) {
    return this.enrollments.enrollContact(...args);
  }
}
