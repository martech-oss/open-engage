export type ProjectResourceLinkOutcome =
  | { kind: "done"; changed: boolean }
  | { kind: "conflict" }
  | { kind: "resource_not_found" };
