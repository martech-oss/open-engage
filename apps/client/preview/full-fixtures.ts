import * as z from "zod";

import * as reports from "@openengage/core/reports";
import { segmentRowSchema, segmentGenerationCatalogSchema } from "@openengage/core/segments";
import { capabilitiesForRole } from "@openengage/core/workspaces";

const at = "2026-09-12T06:00:00Z";
const range = { from: "2026-08-14", to: "2026-09-12" };
// Deliberate empty report data, validated by each public output schema.
function emptyValue(schema: any): any {
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) {
    const nullable = schema.anyOf.find((s: any) => s.type === "null");
    return emptyValue(nullable ?? schema.anyOf[0]);
  }
  if (schema.type === "null") return null;
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([key]) => (schema.required ?? []).includes(key))
        .map(([key, value]) => [key, emptyValue(value)]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer")
    return Math.max(schema.minimum ?? 0, 0);
  if (schema.type === "boolean") return false;
  if (schema.format === "date") return range.to;
  if (schema.format === "date-time") return at;
  return "";
}
function emptyReport(name: string, input: any) {
  const schema = (reports as any)[`${name}ReportSchema`];
  if (!schema) throw new Error(`Missing report fixture: ${name}`);
  const data = emptyValue(z.toJSONSchema(schema));
  return schema.parse({
    ...data,
    range: { from: input?.from ?? range.from, to: input?.to ?? range.to },
    currency: "JPY",
    currencies: ["JPY"],
  });
}
const segment = segmentRowSchema.parse({
  id: "segment-0",
  name: "関心度の高い見込み客",
  slug: "engaged-leads",
  description: "スコアが60以上の連絡先を確認します。",
  kind: "dynamic",
  filterAst: {
    kind: "group",
    combinator: "and",
    children: [{ kind: "condition", field: "score", operator: "gte", value: 60 }],
  },
  membershipSource: null,
  filterVersion: 1,
  memberCount: 4,
  evaluatedAt: at,
  evaluationStatus: "ready",
  evaluationError: null,
  createdAt: at,
  updatedAt: at,
});
export function additionalFixture(
  path: string,
  input: any,
  base: (path: string, input: any) => any,
) {
  const empty = new URLSearchParams(location.search).get("state") === "empty";
  const catalog = segmentGenerationCatalogSchema.parse({
    tags: [],
    staticSegments: [],
    companies: [],
    subscriptionTopics: [],
    events: [],
    customFields: [],
    stages: ["lead", "qualified"],
    categories: [],
    projects: [],
    projectStatuses: [],
  });
  if (path === "segments.options") return catalog;
  if (path === "segments.list" && input?.kind === "dynamic") return empty ? [] : [segment];
  if (path === "segments.get" && input?.id === segment.id)
    return { ...segment, memberCount: empty ? 0 : 4 };
  if (path === "contacts.list" && input?.segmentId === segment.id) {
    const items = empty ? [] : base("contacts.list", {}).items.filter((c: any) => c.score >= 60);
    return { items, total: items.length, nextCursor: null };
  }
  if (path === "app.bootstrap") {
    const workspace = {
      id: "fixture",
      name: "OpenEngage",
      slug: "preview",
      logo: null,
      timezone: "Asia/Tokyo",
      created_at: Date.parse(at),
      role: "marketer",
      capabilities: capabilitiesForRole("marketer"),
    };
    return {
      viewer: { id: "fixture-owner", name: "田中 太郎", email: "tanaka@example.com" },
      workspace,
      workspaces: [workspace],
    };
  }
  if (path === "scoring.listRules")
    return { items: [], total: 0, summary: { enabled: 0, pageActions: 0 } };
  if (path === "scoring.listCriteria")
    return { items: [], total: 0, summary: { enabled: 0, totalSteps: 0 } };
  if (path === "scoring.listCategories") return [];
  if (path === "emails.getTrackingSettings")
    return { openTrackingEnabled: true, clickTrackingEnabled: true, updatedAt: at };
  if (path === "workspace.getEmailBrand")
    return {
      brandName: "OpenEngage",
      companyDescription: "マーケティング活動の分析と運用",
      tone: "簡潔でわかりやすい文章",
      logoAssetId: null,
      websiteUrl: null,
      primaryColor: "#2457c5",
      backgroundColor: "#ffffff",
      textColor: "#20252b",
      postalAddress: "",
      updatedAt: at,
    };
  if (
    [
      "website.listForms",
      "website.listPages",
      "website.listMessages",
      "website.listRedirects",
      "website.listFormHandlers",
      "emails.listVariables",
      "emails.listTemplates",
    ].includes(path)
  )
    return [];
  if (path === "website.getTracking")
    return {
      enabled: false,
      allowedDomains: [],
      consentMode: "required",
      workspaceSlug: "preview",
      summary: { pageViews: 0, uniqueVisitors: 0, identifiedContacts: 0 },
      topPages: [],
      recentEvents: [],
      updatedAt: at,
    };
  if (path === "assets.list") return { items: [], total: 0, nextCursor: null };
  if (path === "projects.variablesList")
    return { definitions: [], effective: { values: [], diagnostics: [] }, canEdit: true };
  if (path === "projects.variablesUses") return { items: [] };
  if (path === "projects.list") return [];
  if (path === "projects.briefList") return [];
  if (path === "deals.options") return { pipelines: [], contacts: [], companies: [], members: [] };
  if (path === "deals.list")
    return {
      items: [],
      summary: { openCount: 0, openValue: 0, wonCount: 0, wonValue: 0, lostCount: 0 },
    };
  if (["deals.listTasks", "deals.notifications"].includes(path)) return [];
  if (path === "reports.overview")
    return Object.fromEntries(
      ["contacts", "automations", "emails", "deals", "site"].map((name) => [
        name,
        additionalFixture(`reports.${name}`, input, base) ?? base(`reports.${name}`, input),
      ]),
    );
  if (path === "reports.contacts")
    return reports.contactsReportSchema.parse({
      ...base(path, input),
      range,
      summary: { inactiveContacts: 0, anonymousContacts: 0, ...base(path, input).summary },
    });
  if (path === "reports.emails") {
    const data = base(path, input);
    return reports.emailsReportSchema.parse({
      ...data,
      summary: { complaints: 0, unsubscribeRate: 0, ...data.summary },
    });
  }
  if (path.startsWith("reports.")) return emptyReport(path.split(".")[1], input);
  if (path === "automations.getDraft") {
    const flow = base("automations.list", {}).find(
      (flow: any) => flow.id === input.id || ["welcome", "event"].includes(input.id),
    );
    if (!flow) throw new Error("フローが見つかりません");
    return {
      graph: {
        name: flow.name,
        description: "連絡先の登録後にフォローします。",
        timezone: "Asia/Tokyo",
        nodes: [
          {
            id: "source",
            type: "source",
            position: { x: 240, y: 60 },
            config: { source: "contact_created" },
          },
        ],
        edges: [],
      },
      status: flow.status,
      publishedTriggerSource: "contact_created",
      publishability: {
        publishable: true,
        capabilityState: "transactional-compatible",
        issues: [],
        templates: [],
      },
    };
  }
  if (["automations.listRuns", "automations.listEnrollments"].includes(path)) return [];
  if (path === "automations.executionOptions")
    return { lists: [], segments: [], automations: [], projects: [] };
  return undefined;
}
