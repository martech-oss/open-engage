import { formHandlerProcedures } from "./form-handler-router";
import { formProcedures } from "./form-router";
import { optimizationProcedures } from "./optimization-router";
import { pageProcedures } from "./page-router";
import { redirectProcedures } from "./redirect-router";
import { siteMessageProcedures } from "./site-message-router";
import { trackingProcedures } from "./tracking-router";

export const websiteProcedures = {
  ...formHandlerProcedures,
  ...optimizationProcedures,
  ...formProcedures,
  ...pageProcedures,
  ...siteMessageProcedures,
  ...redirectProcedures,
  ...trackingProcedures,
};
