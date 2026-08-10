import type {
  MarketingCapabilitySnapshot,
  ProjectBriefDetail,
  ProjectBriefMutation,
  ProjectBriefSummary,
  ProjectMemberOption,
  ProjectResourceType,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import type { DatabaseSource } from "../client";
import {
  ProjectBriefCommandRepository,
  type ProjectBriefCommandOutcome,
} from "./project-brief-command-repository";
import {
  ProjectBriefQueryRepository,
  type ProjectBriefRecord,
} from "./project-brief-query-repository";
import {
  ProjectResourceLinkRepository,
  type ProjectResourceLinkOutcome,
} from "./project-resource-link-repository";

/**
 * Compatibility facade for existing imports. New code should depend on the
 * query, command, or resource-link repository matching its responsibility.
 */
export class ProjectBriefRepository {
  private readonly query: ProjectBriefQueryRepository;
  private readonly command: ProjectBriefCommandRepository;
  private readonly links: ProjectResourceLinkRepository;

  public constructor(source: DatabaseSource, context: WorkspaceContext) {
    this.query = new ProjectBriefQueryRepository(source, context);
    this.command = new ProjectBriefCommandRepository(source, context);
    this.links = new ProjectResourceLinkRepository(source, context);
  }

  public listBriefs(): Promise<ProjectBriefSummary[]> {
    return this.query.listBriefs();
  }

  public getBrief(
    projectId: string,
    capabilities: MarketingCapabilitySnapshot,
  ): Promise<ProjectBriefDetail | null> {
    return this.query.getBrief(projectId, capabilities);
  }

  public findRecord(projectId: string): Promise<ProjectBriefRecord | null> {
    return this.query.findRecord(projectId);
  }

  public eligibleMembers(): Promise<ProjectMemberOption[]> {
    return this.query.eligibleMembers();
  }

  public async createBrief(input: ProjectBriefMutation): Promise<{ id: string }> {
    const result = await this.command.createBrief(input);
    if (result.kind !== "done") throw new InvalidProjectBriefMemberError();
    return { id: result.id };
  }

  public updateBrief(
    projectId: string,
    input: ProjectBriefMutation & { expectedRowVersion?: number | undefined },
  ): Promise<ProjectBriefCommandOutcome> {
    return this.command.updateBrief(projectId, input);
  }

  public setPending(
    projectId: string,
    input: { expectedRowVersion?: number | undefined } = {},
  ): Promise<ProjectBriefCommandOutcome> {
    return this.command.submit(projectId, input);
  }

  public review(
    projectId: string,
    input: {
      decision: "approved" | "rejected";
      comment: string;
      expectedRowVersion?: number | undefined;
    },
  ): Promise<ProjectBriefCommandOutcome> {
    return this.command.review(projectId, input);
  }

  public reopen(
    projectId: string,
    input: { expectedRowVersion?: number | undefined } = {},
  ): Promise<ProjectBriefCommandOutcome> {
    return this.command.reopen(projectId, input);
  }

  public complete(
    projectId: string,
    input: { expectedRowVersion?: number | undefined } = {},
  ): Promise<ProjectBriefCommandOutcome> {
    return this.command.complete(projectId, input);
  }

  public archive(
    projectId: string,
    input: { expectedRowVersion?: number | undefined } = {},
  ): Promise<ProjectBriefCommandOutcome> {
    return this.command.archive(projectId, input);
  }

  public addApprovedItem(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  }): Promise<ProjectResourceLinkOutcome> {
    return this.links.addApproved(input);
  }

  public removeItem(input: {
    projectId: string;
    resourceType: ProjectResourceType;
    resourceId: string;
    expectedRowVersion?: number | undefined;
  }): Promise<ProjectResourceLinkOutcome> {
    return this.links.removeApproved(input);
  }
}

export class InvalidProjectBriefMemberError extends Error {
  public override readonly name = "InvalidProjectBriefMemberError";
}

export type { ProjectBriefRecord } from "./project-brief-query-repository";
