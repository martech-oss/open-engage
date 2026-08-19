import {
  CampaignTouchRepository,
  type OpenEngageDatabase,
  type TouchCandidate,
} from "@openengage/database";

/**
 * Maps a contact event onto the project resource it belongs to. Only events
 * whose resource can appear on a project produce a touch - a bare page view is
 * not attributable because the URL is not a resource the project lists.
 */
export async function recordCampaignTouches(
  database: OpenEngageDatabase,
  input: {
    id: string;
    workspaceId: string;
    contactId: string;
    type: string;
    resourceId: string | null;
    occurredAt: string;
  },
): Promise<number> {
  if (!input.resourceId) return 0;
  const repository = new CampaignTouchRepository(database);
  const candidate = await toCandidate(repository, input);
  if (!candidate) return 0;
  return repository.recordTouches({
    sourceEventId: input.id,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    candidate,
    eventType: input.type,
    occurredAt: input.occurredAt,
  });
}

async function toCandidate(
  repository: CampaignTouchRepository,
  input: { workspaceId: string; type: string; resourceId: string | null },
): Promise<TouchCandidate | null> {
  const resourceId = input.resourceId;
  if (!resourceId) return null;
  switch (input.type) {
    case "form_submitted":
      return { resourceType: "form", resourceId };
    case "segment_joined":
      return { resourceType: "segment", resourceId };
    case "custom_redirect_clicked":
      return { resourceType: "redirect", resourceId };
    case "email_opened":
    case "email_clicked":
    case "email_replied": {
      // These name a delivery; projects list the template behind it.
      const templateId = await repository.resolveTemplateId(input.workspaceId, resourceId);
      return templateId ? { resourceType: "email", resourceId: templateId } : null;
    }
    default:
      return null;
  }
}
