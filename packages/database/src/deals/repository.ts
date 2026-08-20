import { WorkspaceRepository } from "../shared/repository-base";
import { DealRecordRepository } from "./deal-repository";
import { DealOptionsRepository } from "./options-repository";
import { PipelineDefaultStateRepository } from "./pipeline-default-state";
import { DealPipelineRepository } from "./pipeline-repository";
import { DealTaskRepository } from "./task-repository";

export * from "./types";

/** Compatibility facade. New code may depend on the focused repositories directly. */
export class DealRepository extends WorkspaceRepository {
  private readonly options = new DealOptionsRepository(this.database, this.context);
  private readonly deals = new DealRecordRepository(this.database, this.context);
  private readonly tasks = new DealTaskRepository(this.database, this.context);
  private readonly pipelines = new DealPipelineRepository(this.database, this.context);
  private readonly defaults = new PipelineDefaultStateRepository(this.database, this.context);

  public ensureDefaultPipeline(
    ...args: Parameters<PipelineDefaultStateRepository["ensureDefaultPipeline"]>
  ) {
    return this.defaults.ensureDefaultPipeline(...args);
  }
  public validateDealReferences(
    ...args: Parameters<DealRecordRepository["validateDealReferences"]>
  ) {
    return this.deals.validateDealReferences(...args);
  }
  public pipelineExists(...args: Parameters<DealOptionsRepository["pipelineExists"]>) {
    return this.options.pipelineExists(...args);
  }
  public dealExists(...args: Parameters<DealOptionsRepository["dealExists"]>) {
    return this.options.dealExists(...args);
  }
  public memberExists(...args: Parameters<DealOptionsRepository["memberExists"]>) {
    return this.options.memberExists(...args);
  }
  public getDealOptions(...args: Parameters<DealOptionsRepository["getDealOptions"]>) {
    return this.options.getDealOptions(...args);
  }
  public getDealOptionRows(...args: Parameters<DealOptionsRepository["getDealOptionRows"]>) {
    return this.options.getDealOptionRows(...args);
  }
  public getDeal(...args: Parameters<DealRecordRepository["getDeal"]>) {
    return this.deals.getDeal(...args);
  }
  public listDeals(...args: Parameters<DealRecordRepository["listDeals"]>) {
    return this.deals.listDeals(...args);
  }
  public createDeal(...args: Parameters<DealRecordRepository["createDeal"]>) {
    return this.deals.createDeal(...args);
  }
  public updateDeal(...args: Parameters<DealRecordRepository["updateDeal"]>) {
    return this.deals.updateDeal(...args);
  }
  public stageExistsInPipeline(...args: Parameters<DealRecordRepository["stageExistsInPipeline"]>) {
    return this.deals.stageExistsInPipeline(...args);
  }
  public moveDeal(...args: Parameters<DealRecordRepository["moveDeal"]>) {
    return this.deals.moveDeal(...args);
  }
  public archiveDeal(...args: Parameters<DealRecordRepository["archiveDeal"]>) {
    return this.deals.archiveDeal(...args);
  }
  public listDealTasks(...args: Parameters<DealTaskRepository["listDealTasks"]>) {
    return this.tasks.listDealTasks(...args);
  }
  public listWorkspaceTasks(...args: Parameters<DealTaskRepository["listWorkspaceTasks"]>) {
    return this.tasks.listWorkspaceTasks(...args);
  }
  public getTask(...args: Parameters<DealTaskRepository["getTask"]>) {
    return this.tasks.getTask(...args);
  }
  public createDealTask(...args: Parameters<DealTaskRepository["createDealTask"]>) {
    return this.tasks.createDealTask(...args);
  }
  public updateDealTask(...args: Parameters<DealTaskRepository["updateDealTask"]>) {
    return this.tasks.updateDealTask(...args);
  }
  public deleteDealTask(...args: Parameters<DealTaskRepository["deleteDealTask"]>) {
    return this.tasks.deleteDealTask(...args);
  }
  public getPipeline(...args: Parameters<DealPipelineRepository["getPipeline"]>) {
    return this.pipelines.getPipeline(...args);
  }
  public getPipelineWithStages(
    ...args: Parameters<DealPipelineRepository["getPipelineWithStages"]>
  ) {
    return this.pipelines.getPipelineWithStages(...args);
  }
  public createPipeline(...args: Parameters<DealPipelineRepository["createPipeline"]>) {
    return this.pipelines.createPipeline(...args);
  }
  public updatePipeline(...args: Parameters<DealPipelineRepository["updatePipeline"]>) {
    return this.pipelines.updatePipeline(...args);
  }
  public archivePipeline(...args: Parameters<DealPipelineRepository["archivePipeline"]>) {
    return this.pipelines.archivePipeline(...args);
  }
}
