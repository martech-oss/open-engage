import { describe, expect, it } from "vitest";

import { decodeReconciliationContactIds } from "./import-part-state";

describe("decodeReconciliationContactIds", () => {
  it("decodes string ids and rejects malformed stored values", () => {
    expect(decodeReconciliationContactIds('["contact-a","contact-b"]')).toEqual([
      "contact-a",
      "contact-b",
    ]);
    expect(() => decodeReconciliationContactIds('["contact-a",1]')).toThrow(
      "contact_import_parts.reconciliation_contact_ids is malformed",
    );
  });
});
