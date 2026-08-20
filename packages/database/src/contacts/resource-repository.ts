import { ManualScoringRepository } from "../scoring/manual-score-repository";
import { WorkspaceRepository } from "../shared/repository-base";
import { ContactStateRepository } from "./contact-state-repository";
import { ContactResourceQueryRepository } from "./resource-query-repository";
import { ContactSegmentMembershipRepository } from "./segment-membership-repository";
import { ContactTagRepository } from "./tag-membership-repository";

/** Compatibility facade over focused contact-resource repositories. */
export class ContactResourceRepository extends WorkspaceRepository {
  private readonly queries = new ContactResourceQueryRepository(this.database, this.context);
  private readonly tags = new ContactTagRepository(this.database, this.context);
  private readonly segments = new ContactSegmentMembershipRepository(this.database, this.context);
  private readonly state = new ContactStateRepository(this.database, this.context);
  private readonly scoring = new ManualScoringRepository(this.database, this.context);

  public getContactOptionRows(
    ...args: Parameters<ContactResourceQueryRepository["getContactOptionRows"]>
  ) {
    return this.queries.getContactOptionRows(...args);
  }
  public getContactProfileRows(
    ...args: Parameters<ContactResourceQueryRepository["getContactProfileRows"]>
  ) {
    return this.queries.getContactProfileRows(...args);
  }
  public listContactEvents(
    ...args: Parameters<ContactResourceQueryRepository["listContactEvents"]>
  ) {
    return this.queries.listContactEvents(...args);
  }
  public listContactRelations(
    ...args: Parameters<ContactResourceQueryRepository["listContactRelations"]>
  ) {
    return this.queries.listContactRelations(...args);
  }
  public contactExists(...args: Parameters<ContactResourceQueryRepository["contactExists"]>) {
    return this.queries.contactExists(...args);
  }
  public findActiveContactId(
    ...args: Parameters<ContactResourceQueryRepository["findActiveContactId"]>
  ) {
    return this.queries.findActiveContactId(...args);
  }
  public createTag(...args: Parameters<ContactTagRepository["createTag"]>) {
    return this.tags.createTag(...args);
  }
  public updateTag(...args: Parameters<ContactTagRepository["updateTag"]>) {
    return this.tags.updateTag(...args);
  }
  public addContactTag(...args: Parameters<ContactTagRepository["addContactTag"]>) {
    return this.tags.addContactTag(...args);
  }
  public bulkAddContactTag(...args: Parameters<ContactTagRepository["bulkAddContactTag"]>) {
    return this.tags.bulkAddContactTag(...args);
  }
  public removeContactTag(...args: Parameters<ContactTagRepository["removeContactTag"]>) {
    return this.tags.removeContactTag(...args);
  }
  public bulkRemoveContactTag(...args: Parameters<ContactTagRepository["bulkRemoveContactTag"]>) {
    return this.tags.bulkRemoveContactTag(...args);
  }
  public addContactSegment(
    ...args: Parameters<ContactSegmentMembershipRepository["addContactSegment"]>
  ) {
    return this.segments.addContactSegment(...args);
  }
  public bulkAddContactSegment(
    ...args: Parameters<ContactSegmentMembershipRepository["bulkAddContactSegment"]>
  ) {
    return this.segments.bulkAddContactSegment(...args);
  }
  public removeContactSegment(
    ...args: Parameters<ContactSegmentMembershipRepository["removeContactSegment"]>
  ) {
    return this.segments.removeContactSegment(...args);
  }
  public bulkRemoveContactSegment(
    ...args: Parameters<ContactSegmentMembershipRepository["bulkRemoveContactSegment"]>
  ) {
    return this.segments.bulkRemoveContactSegment(...args);
  }
  public adjustContactScore(...args: Parameters<ManualScoringRepository["adjustContactScore"]>) {
    return this.scoring.adjustContactScore(...args);
  }
  public bulkSetContactsArchived(
    ...args: Parameters<ContactStateRepository["bulkSetContactsArchived"]>
  ) {
    return this.state.bulkSetContactsArchived(...args);
  }
}
