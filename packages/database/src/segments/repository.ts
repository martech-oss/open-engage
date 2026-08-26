import { WorkspaceRepository } from "../shared/repository-base";
import { SegmentCatalogRepository } from "./catalog-repository";
import { SegmentCommandRepository } from "./command-repository";
import { SegmentEvaluationRepository } from "./evaluation-repository";
import { SegmentQueryRepository } from "./query-repository";

export { SegmentMaintenanceRepository } from "./maintenance-repository";
export type { SegmentRecord } from "./types";

/** Compatibility facade over focused segment repositories. */
export class SegmentRepository extends WorkspaceRepository {
  private readonly queries = new SegmentQueryRepository(this.database, this.context);
  private readonly commands = new SegmentCommandRepository(this.database, this.context);
  private readonly evaluation = new SegmentEvaluationRepository(this.database, this.context);
  private readonly catalog = new SegmentCatalogRepository(this.database, this.context);

  public isSlugAvailable(...args: Parameters<SegmentQueryRepository["isSlugAvailable"]>) {
    return this.queries.isSlugAvailable(...args);
  }

  public listSegments(...args: Parameters<SegmentQueryRepository["listSegments"]>) {
    return this.queries.listSegments(...args);
  }
  public createSegment(...args: Parameters<SegmentCommandRepository["createSegment"]>) {
    return this.commands.createSegment(...args);
  }
  public findSegmentDefinition(
    ...args: Parameters<SegmentQueryRepository["findSegmentDefinition"]>
  ) {
    return this.queries.findSegmentDefinition(...args);
  }
  public getSegment(...args: Parameters<SegmentQueryRepository["getSegment"]>) {
    return this.queries.getSegment(...args);
  }
  public updateSegment(...args: Parameters<SegmentCommandRepository["updateSegment"]>) {
    return this.commands.updateSegment(...args);
  }
  public setEvaluationState(
    ...args: Parameters<SegmentEvaluationRepository["setEvaluationState"]>
  ) {
    return this.evaluation.setEvaluationState(...args);
  }
  public updateMemberCount(...args: Parameters<SegmentEvaluationRepository["updateMemberCount"]>) {
    return this.evaluation.updateMemberCount(...args);
  }
  public replaceDynamicMemberships(
    ...args: Parameters<SegmentEvaluationRepository["replaceDynamicMemberships"]>
  ) {
    return this.evaluation.replaceDynamicMemberships(...args);
  }
  public previewContacts(...args: Parameters<SegmentEvaluationRepository["previewContacts"]>) {
    return this.evaluation.previewContacts(...args);
  }
  public previewCount(...args: Parameters<SegmentEvaluationRepository["previewCount"]>) {
    return this.evaluation.previewCount(...args);
  }
  public loadGenerationCatalogRows(
    ...args: Parameters<SegmentCatalogRepository["loadGenerationCatalogRows"]>
  ) {
    return this.catalog.loadGenerationCatalogRows(...args);
  }
  public listDynamicDefinitions(
    ...args: Parameters<SegmentCatalogRepository["listDynamicDefinitions"]>
  ) {
    return this.catalog.listDynamicDefinitions(...args);
  }
  public contactMatchesBatch(
    ...args: Parameters<SegmentEvaluationRepository["contactMatchesBatch"]>
  ) {
    return this.evaluation.contactMatchesBatch(...args);
  }
  public setDynamicMemberships(
    ...args: Parameters<SegmentEvaluationRepository["setDynamicMemberships"]>
  ) {
    return this.evaluation.setDynamicMemberships(...args);
  }
}
