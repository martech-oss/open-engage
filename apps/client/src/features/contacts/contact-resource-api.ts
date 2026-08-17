import { orpc, orpcQuery } from "@/lib/orpc";
import type { Tag, TagCreate, TagUpdate } from "@openengage/core/contacts";

type TagResource = Tag;

export interface ContactResources {
  tags: TagResource[];
}

export function contactResourcesQueryOptions() {
  return orpcQuery.contacts.options.queryOptions({
    select: (options): ContactResources => ({ tags: options.tags }),
  });
}

export function createContactTag(input: TagCreate) {
  return orpc.contacts.createTag(input);
}

export function updateContactTag(input: TagUpdate) {
  return orpc.contacts.updateTag(input);
}
