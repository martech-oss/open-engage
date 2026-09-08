import type { OpenEngageDatabase } from "@openengage/database/client";
import { VisitorRepository } from "@openengage/database/contacts";
import { isConstraintError } from "@openengage/database/shared";

import type { RuntimeEnv } from "../env";
import { createSignedToken, verifySignedToken } from "../platform/crypto";

export class VisitorIdentityService {
  private readonly repository: VisitorRepository;
  public constructor(
    database: OpenEngageDatabase,
    private readonly environment: Pick<RuntimeEnv, "TRACKING_SIGNING_SECRET">,
  ) {
    this.repository = new VisitorRepository(database);
  }

  public async resolve(workspaceId: string, token: unknown) {
    if (
      typeof token !== "string" ||
      token.length > 2000 ||
      !this.environment.TRACKING_SIGNING_SECRET
    )
      return null;
    const payload = await verifySignedToken(
      this.environment.TRACKING_SIGNING_SECRET,
      token,
      "visitor",
    );
    if (!payload || payload.workspaceId !== workspaceId) return null;
    return await this.repository.find(workspaceId, payload.resourceId);
  }

  public async token(workspaceId: string, visitorId: string): Promise<string> {
    if (!this.environment.TRACKING_SIGNING_SECRET)
      throw new Error("Tracking signing secret is not configured");
    return await createSignedToken(this.environment.TRACKING_SIGNING_SECRET, {
      workspaceId,
      resourceId: visitorId,
      purpose: "visitor",
      expiresAt: Date.now() + 90 * 86_400_000,
    });
  }

  public async ensure(workspaceId: string, token: unknown) {
    const existing = await this.resolve(workspaceId, token);
    if (existing) return existing;
    const id = crypto.randomUUID();
    await this.repository.create(workspaceId, id);
    return { id, contactId: null, email: null };
  }

  public async issueAssertion(workspaceId: string, contactId: string): Promise<string | null> {
    if (!(await this.repository.findContact(workspaceId, contactId))) return null;
    return await createSignedToken(this.environment.TRACKING_SIGNING_SECRET, {
      workspaceId,
      resourceId: contactId,
      purpose: "identify",
      expiresAt: Date.now() + 10 * 60_000,
    });
  }

  public async identify(workspaceId: string, visitorId: string, assertion: unknown) {
    if (typeof assertion !== "string" || assertion.length > 2000) return null;
    const payload = await verifySignedToken(
      this.environment.TRACKING_SIGNING_SECRET,
      assertion,
      "identify",
    );
    if (
      !payload ||
      payload.workspaceId !== workspaceId ||
      !(await this.repository.findContact(workspaceId, payload.resourceId))
    )
      return null;
    const bound = await this.repository.binding(workspaceId, visitorId);
    let id = visitorId;
    if (bound && bound.contactId !== payload.resourceId) {
      id = crypto.randomUUID();
      await this.repository.create(workspaceId, id);
    }
    try {
      await this.repository.bind(workspaceId, id, payload.resourceId);
    } catch (error) {
      if (!isConstraintError(error)) throw error;
      const winner = await this.repository.binding(workspaceId, id);
      if (!winner || winner.contactId === payload.resourceId) throw error;
      id = crypto.randomUUID();
      await this.repository.create(workspaceId, id);
      await this.repository.bind(workspaceId, id, payload.resourceId);
    }
    return await this.repository.find(workspaceId, id);
  }
}
