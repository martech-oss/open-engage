import * as z from "zod";

const dashboardEventSchema = z.object({
  type: z.string(),
  occurredAt: z.string(),
  contactId: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
});

export const dashboardSchema = z.object({
  asOf: z.iso.datetime(),
  timezone: z.string(),
  contacts: z.object({
    count: z.number().int().nonnegative(),
    trend: z.object({
      from: z.iso.date(),
      to: z.iso.date(),
      points: z.array(z.object({ day: z.iso.date(), added: z.number().int().nonnegative() })),
    }),
    changePercent: z.number().nullable(),
  }),
  automations: z.object({
    count: z.number().int().nonnegative(),
    draftCount: z.number().int().nonnegative(),
    enrolledCount: z.number().int().nonnegative(),
    top: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        active: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        updatedAt: z.iso.datetime(),
      }),
    ),
  }),
  briefs: z.object({ overdueReviews: z.number().int().nonnegative() }),
  deliveries: z.object({
    sent: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    deliveryRate: z.number().nonnegative(),
    totalsRange: z.object({ from: z.iso.date(), to: z.iso.date() }),
    health: z.object({
      from: z.iso.date(),
      to: z.iso.date(),
      points: z.array(
        z.object({
          day: z.iso.date(),
          sends: z.number().int().nonnegative(),
          delivered: z.number().int().nonnegative(),
          undelivered: z.number().int().nonnegative(),
        }),
      ),
    }),
    sendChangePercent: z.number().nullable(),
    deliveryRateChangePoints: z.number().nullable(),
  }),
  deals: z.object({
    range: z.object({ from: z.iso.date(), to: z.iso.date() }),
    currency: z.string(),
    created: z.number().int().nonnegative(),
    openCount: z.number().int().nonnegative(),
    openValue: z.number().nonnegative(),
    averageOpenValue: z.number().nonnegative(),
    openTasks: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
    completedTasks: z.number().int().nonnegative(),
  }),
  recentEvents: z.array(dashboardEventSchema),
  recentActivity: z.array(dashboardEventSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const reportCategorySchema = z.enum([
  "contacts",
  "automations",
  "emails",
  "deals",
  "site",
  "campaigns",
]);
export type ReportCategory = z.infer<typeof reportCategorySchema>;

export const reportDateRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .superRefine((range, context) => {
    const from = new Date(`${range.from}T00:00:00.000Z`);
    const to = new Date(`${range.to}T00:00:00.000Z`);
    if (from > to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "終了日は開始日以降にしてください",
      });
      return;
    }
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 366) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "レポート期間は366日以内にしてください",
      });
    }
  });
export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;

export const reportQuerySchema = reportDateRangeSchema.safeExtend({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

const reportRangeOutputSchema = z.object({ from: z.iso.date(), to: z.iso.date() });

/** Generic so each trend keeps its own metric keys in the inferred type. */
const dayTrend = <T extends z.ZodRawShape>(shape: T) =>
  z.array(z.object({ day: z.string(), ...shape }));

const int = z.number().int();
const rate = z.number();

export const contactsReportSchema = z.object({
  category: z.literal("contacts"),
  range: reportRangeOutputSchema,
  summary: z.object({
    totalContacts: int,
    activeContacts: int,
    inactiveContacts: int,
    anonymousContacts: int,
    newContacts: int,
    archivedContacts: int,
  }),
  trend: dayTrend({ added: int, archived: int }),
  topTags: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string(), contactCount: int }),
  ),
  topSegments: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string(), contactCount: int }),
  ),
});
export type ContactsReport = z.infer<typeof contactsReportSchema>;

export const automationsReportSchema = z.object({
  category: z.literal("automations"),
  range: reportRangeOutputSchema,
  summary: z.object({
    automationCount: int,
    entries: int,
    completions: int,
    activeContacts: int,
    sends: int,
    opens: int,
    clicks: int,
    completionRate: rate,
    openRate: rate,
    clickRate: rate,
  }),
  trend: dayTrend({ entries: int, completions: int }),
  automations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      entries: int,
      completions: int,
      activeContacts: int,
      sends: int,
      opens: int,
      clicks: int,
    }),
  ),
});
export type AutomationsReport = z.infer<typeof automationsReportSchema>;

export const emailsReportSchema = z.object({
  category: z.literal("emails"),
  range: reportRangeOutputSchema,
  summary: z.object({
    sends: int,
    delivered: int,
    opens: int,
    clicks: int,
    bounces: int,
    unsubscribes: int,
    complaints: int,
    deliveryRate: rate,
    openRate: rate,
    clickRate: rate,
    clickToOpenRate: rate,
    bounceRate: rate,
    unsubscribeRate: rate,
  }),
  trend: dayTrend({ sends: int, delivered: int, opens: int, clicks: int }),
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      sends: int,
      delivered: int,
      opens: int,
      clicks: int,
      bounces: int,
      unsubscribes: int,
      openRate: rate,
      clickRate: rate,
    }),
  ),
});
export type EmailsReport = z.infer<typeof emailsReportSchema>;

export const dealsReportSchema = z.object({
  category: z.literal("deals"),
  range: reportRangeOutputSchema,
  currency: z.string(),
  currencies: z.array(z.string()),
  summary: z.object({
    created: int,
    won: int,
    lost: int,
    wonValue: z.number(),
    openCount: int,
    openValue: z.number(),
    winRate: rate,
    openTasks: int,
    overdueTasks: int,
    completedTasks: int,
  }),
  trend: dayTrend({ created: int, won: int, lost: int }),
  owners: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      created: int,
      won: int,
      lost: int,
      wonValue: z.number(),
      openCount: int,
    }),
  ),
  forecast: z.array(
    z.object({
      stageId: z.string(),
      stageName: z.string(),
      color: z.string(),
      probability: z.number(),
      dealCount: int,
      dealValue: z.number(),
      weightedValue: z.number(),
    }),
  ),
});
export type DealsReport = z.infer<typeof dealsReportSchema>;

export const siteReportSchema = z.object({
  category: z.literal("site"),
  range: reportRangeOutputSchema,
  summary: z.object({
    pageViews: int,
    uniqueVisitors: int,
    identifiedContacts: int,
    identificationRate: rate,
    submissions: int,
    submittingContacts: int,
    messageImpressions: int,
    messageClicks: int,
  }),
  trend: dayTrend({ pageViews: int, submissions: int }),
  topPages: z.array(
    z.object({
      url: z.string(),
      views: int,
      uniqueVisitors: int,
      identifiedContacts: int,
    }),
  ),
  forms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      submissions: int,
      contacts: int,
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      impressions: int,
      clicks: int,
      clickRate: rate,
    }),
  ),
  notes: z.object({ messageMetrics: z.string() }),
});
export type SiteReport = z.infer<typeof siteReportSchema>;

export const reportsOverviewSchema = z.object({
  contacts: contactsReportSchema,
  automations: automationsReportSchema,
  emails: emailsReportSchema,
  deals: dealsReportSchema,
  site: siteReportSchema,
});
export type ReportsOverview = z.infer<typeof reportsOverviewSchema>;

/**
 * Campaign attribution. `influencedValue` credits every project that touched a
 * won deal, so it double counts across rows on purpose; `firstTouchValue` and
 * `lastTouchValue` each split the same revenue exactly once.
 */
export const campaignsReportSchema = z.object({
  category: z.literal("campaigns"),
  range: reportRangeOutputSchema,
  currency: z.string(),
  summary: z.object({
    campaigns: int,
    activeCampaigns: int,
    touches: int,
    contacts: int,
    influencedDeals: int,
    firstTouchValue: int,
    lastTouchValue: int,
  }),
  campaigns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      touches: int,
      contacts: int,
      influencedDeals: int,
      influencedValue: int,
      firstTouchValue: int,
      lastTouchValue: int,
      touchesPerContact: rate,
    }),
  ),
});
export type CampaignsReport = z.infer<typeof campaignsReportSchema>;
