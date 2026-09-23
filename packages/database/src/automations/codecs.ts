import { automationDefinitionSchema } from "@openengage/core/automations";

import { defineJsonCodec } from "../shared/json-codec";

/** automation_versions.graph; decode failures surface as DatabaseDecodeError. */
export const automationGraphCodec = defineJsonCodec(
  automationDefinitionSchema,
  "automation_versions.graph",
);
