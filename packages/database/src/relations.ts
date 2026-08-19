import { relations } from "drizzle-orm";

import {
  automationEnrollments,
  automationJobs,
  automations,
  automationTriggers,
  automationVersions,
} from "./automations/schema";
import {
  consentEvents,
  contactSubscriptions,
  subscriptionTopics,
  suppressions,
} from "./consent/schema";
import {
  companies,
  companyContacts,
  contactEvents,
  contactTags,
  contacts,
  tags,
} from "./contacts/schema";
import { dealPipelines, dealStages, dealTasks, deals } from "./deals/schema";
import { deliveries, deliveryEvents, emailTemplates, inboundEmails } from "./messaging/schema";
import { auditLogs } from "./platform/schema";
import { scoreEvents } from "./scoring/schema";
import { segmentMemberships, segments } from "./segments/schema";
import { formSubmissions, forms, landingPageVersions, landingPages } from "./web/schema";
import { apiKeys, webhookDeliveries, webhookEndpoints } from "./workspaces/schema";

/**
 * The business object graph as Drizzle `relations()`, for the relational
 * query API (`db.query.x.findMany({ with: {...} })`). Nothing in this
 * codebase uses that API yet - every repository builds explicit joins - so
 * this is additive metadata, not a behavior change.
 *
 * Deliberately excluded:
 *  - Every edge to `organization`/`user` (the Better Auth "auth" domain,
 *    out of scope for this whole restructure) - every business table's own
 *    `workspaceId`/`*UserId` FK still exists at the DDL level, it's just not
 *    modeled here. The repository layer always scopes by workspaceId
 *    explicitly regardless, so a `db.query` traversal through `organization`
 *    isn't a pattern this codebase wants to encourage.
 *  - `automations.draftVersionId`/`publishedVersionId` and
 *    `landingPages.currentVersionId` - unconstrained at the DDL level too
 *    (see the comments in their schema.ts files), so there's no FK for a
 *    relation to describe.
 *  - `project_items` - polymorphic (resourceType/resourceId), not a real FK.
 *  - `dead_letters` - its jobId/deliveryId references live inside a JSON
 *    message body, not a FK column.
 */

export const companiesRelations = relations(companies, ({ many }) => ({
  contactLinks: many(companyContacts),
  deals: many(deals),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  companyLinks: many(companyContacts),
  tagLinks: many(contactTags),
  scoreEvents: many(scoreEvents),
  events: many(contactEvents),
  segmentMemberships: many(segmentMemberships),
  automationEnrollments: many(automationEnrollments),
  automationJobs: many(automationJobs),
  deals: many(deals),
  deliveries: many(deliveries),
  formSubmissions: many(formSubmissions),
  subscriptions: many(contactSubscriptions),
  consentEvents: many(consentEvents),
  suppressions: many(suppressions),
  inboundEmails: many(inboundEmails),
}));

export const companyContactsRelations = relations(companyContacts, ({ one }) => ({
  company: one(companies, { fields: [companyContacts.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [companyContacts.contactId], references: [contacts.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  contactLinks: many(contactTags),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, { fields: [contactTags.contactId], references: [contacts.id] }),
  tag: one(tags, { fields: [contactTags.tagId], references: [tags.id] }),
}));

export const scoreEventsRelations = relations(scoreEvents, ({ one }) => ({
  contact: one(contacts, { fields: [scoreEvents.contactId], references: [contacts.id] }),
  automationEnrollment: one(automationEnrollments, {
    fields: [scoreEvents.automationEnrollmentId],
    references: [automationEnrollments.id],
  }),
}));

export const contactEventsRelations = relations(contactEvents, ({ one }) => ({
  contact: one(contacts, { fields: [contactEvents.contactId], references: [contacts.id] }),
}));

export const segmentsRelations = relations(segments, ({ many }) => ({
  memberships: many(segmentMemberships),
}));

export const segmentMembershipsRelations = relations(segmentMemberships, ({ one }) => ({
  segment: one(segments, { fields: [segmentMemberships.segmentId], references: [segments.id] }),
  contact: one(contacts, { fields: [segmentMemberships.contactId], references: [contacts.id] }),
}));

export const automationsRelations = relations(automations, ({ many }) => ({
  versions: many(automationVersions),
  triggers: many(automationTriggers),
  enrollments: many(automationEnrollments),
}));

export const automationVersionsRelations = relations(automationVersions, ({ one, many }) => ({
  automation: one(automations, {
    fields: [automationVersions.automationId],
    references: [automations.id],
  }),
  // automation_triggers.automation_version_id is both that table's PK and its
  // FK back to this row, so this version has at most one trigger.
  trigger: one(automationTriggers, {
    fields: [automationVersions.id],
    references: [automationTriggers.automationVersionId],
  }),
  enrollments: many(automationEnrollments),
  jobs: many(automationJobs),
}));

export const automationTriggersRelations = relations(automationTriggers, ({ one }) => ({
  version: one(automationVersions, {
    fields: [automationTriggers.automationVersionId],
    references: [automationVersions.id],
  }),
  automation: one(automations, {
    fields: [automationTriggers.automationId],
    references: [automations.id],
  }),
}));

export const automationEnrollmentsRelations = relations(automationEnrollments, ({ one, many }) => ({
  automation: one(automations, {
    fields: [automationEnrollments.automationId],
    references: [automations.id],
  }),
  version: one(automationVersions, {
    fields: [automationEnrollments.automationVersionId],
    references: [automationVersions.id],
  }),
  contact: one(contacts, {
    fields: [automationEnrollments.contactId],
    references: [contacts.id],
  }),
  jobs: many(automationJobs),
  scoreEvents: many(scoreEvents),
  deliveries: many(deliveries),
}));

export const automationJobsRelations = relations(automationJobs, ({ one }) => ({
  enrollment: one(automationEnrollments, {
    fields: [automationJobs.enrollmentId],
    references: [automationEnrollments.id],
  }),
  version: one(automationVersions, {
    fields: [automationJobs.automationVersionId],
    references: [automationVersions.id],
  }),
  contact: one(contacts, { fields: [automationJobs.contactId], references: [contacts.id] }),
}));

export const subscriptionTopicsRelations = relations(subscriptionTopics, ({ many }) => ({
  subscriptions: many(contactSubscriptions),
  consentEvents: many(consentEvents),
  deliveries: many(deliveries),
}));

export const contactSubscriptionsRelations = relations(contactSubscriptions, ({ one }) => ({
  topic: one(subscriptionTopics, {
    fields: [contactSubscriptions.topicId],
    references: [subscriptionTopics.id],
  }),
  contact: one(contacts, { fields: [contactSubscriptions.contactId], references: [contacts.id] }),
}));

export const consentEventsRelations = relations(consentEvents, ({ one }) => ({
  contact: one(contacts, { fields: [consentEvents.contactId], references: [contacts.id] }),
  topic: one(subscriptionTopics, {
    fields: [consentEvents.topicId],
    references: [subscriptionTopics.id],
  }),
}));

export const suppressionsRelations = relations(suppressions, ({ one }) => ({
  contact: one(contacts, { fields: [suppressions.contactId], references: [contacts.id] }),
}));

export const emailTemplatesRelations = relations(emailTemplates, ({ many }) => ({
  deliveries: many(deliveries),
}));

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  contact: one(contacts, { fields: [deliveries.contactId], references: [contacts.id] }),
  enrollment: one(automationEnrollments, {
    fields: [deliveries.enrollmentId],
    references: [automationEnrollments.id],
  }),
  topic: one(subscriptionTopics, {
    fields: [deliveries.topicId],
    references: [subscriptionTopics.id],
  }),
  template: one(emailTemplates, {
    fields: [deliveries.templateId],
    references: [emailTemplates.id],
  }),
  events: many(deliveryEvents),
  inboundEmails: many(inboundEmails),
}));

export const deliveryEventsRelations = relations(deliveryEvents, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryEvents.deliveryId], references: [deliveries.id] }),
}));

export const inboundEmailsRelations = relations(inboundEmails, ({ one }) => ({
  contact: one(contacts, { fields: [inboundEmails.contactId], references: [contacts.id] }),
  delivery: one(deliveries, { fields: [inboundEmails.deliveryId], references: [deliveries.id] }),
}));

export const formsRelations = relations(forms, ({ many }) => ({
  submissions: many(formSubmissions),
}));

export const formSubmissionsRelations = relations(formSubmissions, ({ one }) => ({
  form: one(forms, { fields: [formSubmissions.formId], references: [forms.id] }),
  contact: one(contacts, { fields: [formSubmissions.contactId], references: [contacts.id] }),
}));

export const landingPagesRelations = relations(landingPages, ({ many }) => ({
  versions: many(landingPageVersions),
}));

export const landingPageVersionsRelations = relations(landingPageVersions, ({ one }) => ({
  page: one(landingPages, { fields: [landingPageVersions.pageId], references: [landingPages.id] }),
}));

export const dealPipelinesRelations = relations(dealPipelines, ({ many }) => ({
  stages: many(dealStages),
  deals: many(deals),
}));

export const dealStagesRelations = relations(dealStages, ({ one, many }) => ({
  pipeline: one(dealPipelines, {
    fields: [dealStages.pipelineId],
    references: [dealPipelines.id],
  }),
  deals: many(deals),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  pipeline: one(dealPipelines, { fields: [deals.pipelineId], references: [dealPipelines.id] }),
  stage: one(dealStages, { fields: [deals.stageId], references: [dealStages.id] }),
  contact: one(contacts, { fields: [deals.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [deals.companyId], references: [companies.id] }),
  tasks: many(dealTasks),
}));

export const dealTasksRelations = relations(dealTasks, ({ one }) => ({
  deal: one(deals, { fields: [dealTasks.dealId], references: [deals.id] }),
}));

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, {
    fields: [webhookDeliveries.endpointId],
    references: [webhookEndpoints.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
  auditLogs: many(auditLogs),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [auditLogs.apiKeyId], references: [apiKeys.id] }),
}));

// Tables intentionally left out of this relational graph are still registered
// once through their owning schema modules (for example assets/schema.ts and
// projects/schema.ts). They are queried with explicit workspace-scoped joins:
// custom_field_definitions, import_jobs, assets, projects/project_items,
// site_tracking_settings, site_messages, message_variables, provider_configs,
// idempotency_keys, dead_letters, daily_metrics.
