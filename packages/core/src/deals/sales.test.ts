import { expect, it } from "vitest";

import * as schemas from "./schema";
it("requires a contact or deal task link", () => {
  expect(schemas.contactTaskCreateSchema.safeParse({ title: "Call" }).success).toBe(false);
  expect(
    schemas.contactTaskCreateSchema.safeParse({ title: "Call", contactId: "c1" }).success,
  ).toBe(true);
});
it("requires a stable execution key for sales handoff", () => {
  expect(schemas.salesHandoffSchema.safeParse({ contactId: "c1", title: "Call" }).success).toBe(
    false,
  );
  expect(
    schemas.salesHandoffSchema.safeParse({
      contactId: "c1",
      title: "Call",
      executionKey: "run-1",
      ownerUserId: "u1",
    }).success,
  ).toBe(true);
});
