import type { DatabaseSource } from "../client";
import { DatabaseRepository } from "../shared/repository-base";
import { AutomationContactActionRepository } from "./contact-action-repository";
import { AutomationDecisionRepository } from "./decision-repository";
import { AutomationJobRepository } from "./engine-job-repository";
import { AutomationInactivityRepository } from "./inactivity-repository";

export { AUTOMATION_MAX_STARTS } from "./engine-support";
export type {
  AutomationContactColumn,
  AutomationJobRow,
  AutomationJobStatus,
} from "./engine-support";

/** Compatibility and dependency-injection facade for the automation engine. */
export class AutomationEngineRepository extends DatabaseRepository {
  private readonly jobs = new AutomationJobRepository(this.database);
  private readonly decisions = new AutomationDecisionRepository(this.database);
  private readonly actions = new AutomationContactActionRepository(this.database);
  private readonly inactivity = new AutomationInactivityRepository(this.database);

  public workspacesWithDueJobs(
    ...args: Parameters<AutomationJobRepository["workspacesWithDueJobs"]>
  ) {
    return this.jobs.workspacesWithDueJobs(...args);
  }
  public claimDueJobs(...args: Parameters<AutomationJobRepository["claimDueJobs"]>) {
    return this.jobs.claimDueJobs(...args);
  }
  public findJobForProcessing(
    ...args: Parameters<AutomationJobRepository["findJobForProcessing"]>
  ) {
    return this.jobs.findJobForProcessing(...args);
  }
  public startLeasedJob(...args: Parameters<AutomationJobRepository["startLeasedJob"]>) {
    return this.jobs.startLeasedJob(...args);
  }
  public parkJobUntil(...args: Parameters<AutomationJobRepository["parkJobUntil"]>) {
    return this.jobs.parkJobUntil(...args);
  }
  public completeJobClosingEnrollment(
    ...args: Parameters<AutomationJobRepository["completeJobClosingEnrollment"]>
  ) {
    return this.jobs.completeJobClosingEnrollment(...args);
  }
  public completeJobAdvancingEnrollment(
    ...args: Parameters<AutomationJobRepository["completeJobAdvancingEnrollment"]>
  ) {
    return this.jobs.completeJobAdvancingEnrollment(...args);
  }
  public hasContactEventSince(
    ...args: Parameters<AutomationDecisionRepository["hasContactEventSince"]>
  ) {
    return this.decisions.hasContactEventSince(...args);
  }
  public wakeWaitingDecisionJobs(
    ...args: Parameters<AutomationDecisionRepository["wakeWaitingDecisionJobs"]>
  ) {
    return this.decisions.wakeWaitingDecisionJobs(...args);
  }
  public contactHasTagWithSlug(
    ...args: Parameters<AutomationContactActionRepository["contactHasTagWithSlug"]>
  ) {
    return this.actions.contactHasTagWithSlug(...args);
  }
  public addContactTag(...args: Parameters<AutomationContactActionRepository["addContactTag"]>) {
    return this.actions.addContactTag(...args);
  }
  public removeContactTag(
    ...args: Parameters<AutomationContactActionRepository["removeContactTag"]>
  ) {
    return this.actions.removeContactTag(...args);
  }
  public addAutomationSegmentMembership(
    ...args: Parameters<AutomationContactActionRepository["addAutomationSegmentMembership"]>
  ) {
    return this.actions.addAutomationSegmentMembership(...args);
  }
  public removeSegmentMembership(
    ...args: Parameters<AutomationContactActionRepository["removeSegmentMembership"]>
  ) {
    return this.actions.removeSegmentMembership(...args);
  }
  public updateContactColumn(
    ...args: Parameters<AutomationContactActionRepository["updateContactColumn"]>
  ) {
    return this.actions.updateContactColumn(...args);
  }
  public replaceContactCustomFields(
    ...args: Parameters<AutomationContactActionRepository["replaceContactCustomFields"]>
  ) {
    return this.actions.replaceContactCustomFields(...args);
  }
  public listInactiveEnrollmentCandidates(
    ...args: Parameters<AutomationInactivityRepository["listInactiveEnrollmentCandidates"]>
  ) {
    return this.inactivity.listInactiveEnrollmentCandidates(...args);
  }
}

export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  return new AutomationJobRepository(database).claimDueJobs(now, leaseUntil, limit, workspaceId);
}
