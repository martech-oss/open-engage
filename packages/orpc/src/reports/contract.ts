import { oc } from "@orpc/contract";

import {
  automationsReportSchema,
  campaignsReportSchema,
  contactsReportSchema,
  dealsReportSchema,
  emailsReportSchema,
  reportDateRangeSchema,
  reportQuerySchema,
  reportsOverviewSchema,
  siteReportSchema,
} from "@openengage/core/reports";

import { authedErrors } from "../shared/errors";

/** Reports are analyst-and-above; the range is validated by the shared schema. */
const analystErrors = authedErrors;

const rangeInput = reportDateRangeSchema;

export const reportsContract = {
  overview: oc
    .route({ method: "GET", path: "/reports/overview" })
    .errors(analystErrors)
    .input(reportQuerySchema)
    .output(reportsOverviewSchema),
  contacts: oc
    .route({ method: "GET", path: "/reports/contacts" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(contactsReportSchema),
  automations: oc
    .route({ method: "GET", path: "/reports/automations" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(automationsReportSchema),
  emails: oc
    .route({ method: "GET", path: "/reports/emails" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(emailsReportSchema),
  deals: oc
    .route({ method: "GET", path: "/reports/deals" })
    .errors(analystErrors)
    .input(reportQuerySchema)
    .output(dealsReportSchema),
  site: oc
    .route({ method: "GET", path: "/reports/site" })
    .errors(analystErrors)
    .input(rangeInput)
    .output(siteReportSchema),
  campaigns: oc
    .route({ method: "GET", path: "/reports/campaigns" })
    .errors(analystErrors)
    .input(reportQuerySchema)
    .output(campaignsReportSchema),
};
