const empty = new URLSearchParams(globalThis.location?.search ?? "").get("state") === "empty";
const points = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, "0")}`,
  label: String(i + 1),
  sends: empty ? 0 : 30 + i * 3,
  delivered: empty ? 0 : 29 + i * 3,
  undelivered: empty ? 0 : i % 4,
  added: empty ? 0 : 12 + (i % 9),
}));
const dashboard = {
  contacts: { count: empty ? 0 : 2486, changePercent: 12.4, trend: { points } },
  deliveries: {
    sent: empty ? 0 : 18420,
    failed: empty ? 0 : 12,
    sendChangePercent: 8.2,
    deliveryRate: 98.6,
    deliveryRateChangePoints: 0.8,
    health: { points },
  },
  automations: {
    count: empty ? 0 : 8,
    draftCount: 3,
    enrolledCount: empty ? 0 : 346,
    top: empty
      ? []
      : [
          {
            id: "welcome",
            name: "新規リードのウェルカムシーケンス",
            active: 142,
            completed: 892,
            updatedAt: "2026-09-12T05:00:00Z",
          },
          {
            id: "event",
            name: "ウェビナー参加者フォローアップ",
            active: 84,
            completed: 236,
            updatedAt: "2026-09-12T04:00:00Z",
          },
        ],
  },
  deals: {
    openValue: empty ? 0 : 12400000,
    currency: "JPY",
    created: 12,
    openCount: 24,
    averageOpenValue: 516667,
    overdueTasks: 3,
    openTasks: 18,
    completedTasks: 42,
  },
  briefs: { overdueReviews: 0 },
  recentActivity: empty
    ? []
    : [
        "email_opened",
        "contact_created",
        "email_clicked",
        "delivered",
        "form_submitted",
        "email_opened",
      ].map((type, i) => ({ type, occurredAt: `2026-09-12T0${5 - i}:00:00Z` })),
};
const projects = ["秋のウェビナー集客", "資料請求からの商談化", "導入企業フォローアップ"].map(
  (name, i) => ({
    id: `project-${i}`,
    name,
    description: [
      "参加登録から参加後のフォローまでを管理します。",
      "関心の高い見込み顧客に、必要な情報を届けます。",
      "活用状況を確認し、次の提案につなげます。",
    ][i],
    itemCount: 5 - i,
    updatedAt: "2026-09-12T04:00:00Z",
  }),
);
const automations = [
  "新規リードのウェルカムシーケンス",
  "ウェビナー参加者フォローアップ",
  "休眠顧客へのご案内",
].map((name, i) => ({
  id: `automation-${i}`,
  name,
  status: i === 2 ? "draft" : "active",
  triggerSource: "contact_created",
  enrollmentCount: 246 - i * 40,
  activeCount: 42 - i * 8,
  completedCount: 204 - i * 32,
  updatedAt: "2026-09-12T04:00:00Z",
}));
const contacts = [
  "佐藤 美咲",
  "鈴木 健太",
  "高橋 遥",
  "田中 翔太",
  "伊藤 さくら",
  "渡辺 大輔",
  "山本 結衣",
  "中村 直樹",
].map((name, i) => ({
  id: `contact-${i}`,
  firstName: name.split(" ")[1],
  lastName: name.split(" ")[0],
  email: `contact${i + 1}@example.com`,
  status: "active",
  stage: i % 2 ? "lead" : "qualified",
  score: 87 - i * 8,
  companies: [
    { id: "company", name: ["株式会社アトラス", "ブルースカイ株式会社", "株式会社ミライ"][i % 3] },
  ],
  tags: [{ id: "tag", name: "ウェビナー", color: "#719b82" }],
  updatedAt: "2026-09-12T04:00:00Z",
}));
function oldFixture(path: string, _input: any) {
  if (path === "projects.programCatalog")
    return { projects: empty ? [] : projects, allowedActions: { create: true } };
  if (path === "automations.list") return empty ? [] : automations;
  if (path === "emails.listSegmentOptions") return [];
  if (path === "contacts.list")
    return { items: empty ? [] : contacts, total: empty ? 0 : contacts.length, nextCursor: null };
  if (path === "contacts.options")
    return {
      stages: [
        { stage: "lead", count: 4 },
        { stage: "qualified", count: 4 },
      ],
      tags: [],
      companies: [],
      segments: [],
      lists: [],
      customFields: [],
    };
  if (path === "reports.contacts")
    return {
      category: "contacts",
      summary: {
        totalContacts: empty ? 0 : 2486,
        activeContacts: empty ? 0 : 2401,
        newContacts: empty ? 0 : 186,
        archivedContacts: empty ? 0 : 12,
      },
      trend: empty ? [] : points.map((p) => ({ ...p, archived: 1 })),
      topSegments: [],
      topTags: [],
    };
  return undefined;
}
const range = { from: "2026-08-14", to: "2026-09-12" };
points.forEach((p, i) => {
  p.day = new Date(Date.UTC(2026, 7, 14 + i)).toISOString().slice(0, 10);
  p.date = p.day;
  p.delivered = p.sends - p.undelivered;
});
Object.assign(dashboard, {
  asOf: "2026-09-12T06:00:00Z",
  timezone: "Asia/Tokyo",
  recentEvents: [],
});
Object.assign(dashboard.contacts.trend, range);
Object.assign(dashboard.deliveries, { totalsRange: range, delivered: empty ? 0 : 18162 });
Object.assign(dashboard.deliveries.health, range);
Object.assign(dashboard.deals, { range });
dashboard.recentActivity.forEach((e, i) =>
  Object.assign(e, { contactId: `contact-${i}`, properties: {} }),
);
if (empty) {
  for (const section of [dashboard.automations, dashboard.deals, dashboard.deliveries])
    for (const key of Object.keys(section)) if (typeof section[key] === "number") section[key] = 0;
}
import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
const definition = PROJECT_PROGRAM_TEMPLATES.event;
const version = { version: 1, definition, publishedAt: "2026-09-01T01:00:00Z" };
function extendedFixture(path: string, input: any) {
  if (path === "projects.programGet")
    return {
      project: projects.find((p) => p.id === input?.id) ?? projects[0],
      program: {
        definition,
        publishedDefinition: definition,
        publishedVersion: 1,
        rowVersion: 1,
        versions: [version],
      },
      brief: null,
      formBindings: [],
      allowedActions: { editDefinition: true, publishDefinition: true, manageMembers: true },
    };
  if (path === "projects.programCohort")
    return {
      members: empty ? 0 : 248,
      succeeded: empty ? 0 : 86,
      rate: empty ? 0 : 86 / 248,
      averageTimeToSuccessSeconds: empty ? null : 194400,
    };
  if (path === "projects.memberList")
    return {
      items: empty
        ? []
        : contacts.map((c, i) => ({
            ...c,
            member: {
              id: `member-${i}`,
              contactId: c.id,
              statusLabel: definition.statuses[0].label,
              statusId: definition.statuses[0].id,
              definitionVersion: 1,
              joinedAt: "2026-09-01T01:00:00Z",
              firstSuccessAt: i % 2 ? null : "2026-09-03T07:00:00Z",
              source: "manual",
            },
          })),
      total: empty ? 0 : contacts.length,
    };
  if (path === "website.listForms") return [];
  if (path === "projects.briefOptions")
    return { members: [], projects, forms: [], automations: [], emails: [], segments: [] };
  if (path === "contacts.profile") {
    const c = contacts.find((c) => c.id === input?.contactId) ?? contacts[0];
    return {
      contact: {
        ...c,
        phone: null,
        externalId: null,
        lifecycleStage: "lead",
        createdAt: "2026-08-14T04:00:00Z",
      },
      companies: c.companies,
      tags: c.tags,
      segments: [],
      owner: { id: "fixture-owner", name: "田中 太郎" },
      lifecycleHistory: [],
      timeline: [
        {
          id: "event-1",
          type: "メールを開封",
          occurredAt: "2026-09-12T04:00:00Z",
          resourceType: "ウェビナーのご案内",
          resourceId: null,
        },
        {
          id: "event-2",
          type: "フォーム送信",
          occurredAt: "2026-09-10T04:00:00Z",
          resourceType: "参加登録フォーム",
          resourceId: null,
        },
      ],
      scoreEvents: [
        {
          id: "score-1",
          delta: 10,
          reason: "ウェビナー参加登録",
          createdAt: "2026-09-10T04:00:00Z",
        },
      ],
    };
  }
  if (["deals.salesMembers", "deals.assignmentGroups", "deals.contactTasks"].includes(path))
    return [];
  if (path === "app.bootstrap")
    return {
      viewer: { name: "田中 太郎", email: "tanaka@example.com" },
      workspace: {
        id: "fixture",
        name: "OpenEngage",
        timezone: "Asia/Tokyo",
        capabilities: { manageMarketing: false },
      },
      workspaces: [],
    };
  return undefined;
}
function reportFixture(path: string, _input: any) {
  if (path === "reports.emails")
    return {
      category: "emails",
      range,
      summary: {
        sends: empty ? 0 : 18420,
        delivered: empty ? 0 : 18162,
        opens: empty ? 0 : 6210,
        clicks: empty ? 0 : 1210,
        deliveryRate: 98.6,
        openRate: 34.2,
        clickRate: 6.7,
        clickToOpenRate: 19.5,
        bounceRate: 1.4,
        bounces: empty ? 0 : 258,
        unsubscribes: empty ? 0 : 12,
      },
      trend: empty
        ? []
        : points.map((p) => ({
            ...p,
            opens: Math.round(p.delivered * 0.34),
            clicks: Math.round(p.delivered * 0.07),
          })),
      sources: empty
        ? []
        : [
            {
              id: "welcome",
              name: "新規リードのウェルカムシーケンス",
              type: "automation",
              sends: 18420,
              delivered: 18162,
              opens: 6210,
              clicks: 1210,
              openRate: 34.2,
              clickRate: 6.7,
              bounces: 258,
              unsubscribes: 12,
            },
          ],
    };
  return undefined;
}
import { dashboardSchema } from "@openengage/core/reports";
dashboardSchema.parse(dashboard);

// Company preview uses the real pages and DTO shapes; only transport data is synthetic.
import { companySummarySchema, companyDetailSchema } from "@openengage/core/contacts";
const companies = ["株式会社アトラス", "ブルースカイ株式会社", "株式会社ミライ"].map((name, i) =>
  companySummarySchema.parse({
    id: i === 0 ? "company" : `company-${i}`,
    workspaceId: "fixture",
    name,
    domain: ["atlas.example.com", "bluesky.example.com", null][i],
    createdAt: "2026-08-14T04:00:00Z",
    updatedAt: "2026-09-12T04:00:00Z",
    contactCount: contacts.filter((_, j) => j % 3 === i).length,
  }),
);
function companyFixture(path: string, input: any) {
  if (path === "companies.list")
    return empty
      ? []
      : companies.filter((c) =>
          `${c.name} ${c.domain ?? ""}`
            .toLocaleLowerCase()
            .includes((input?.query ?? "").toLocaleLowerCase()),
        );
  if (path === "companies.enrichmentCapability") return { enabled: false };
  if (path === "companies.get") {
    const i = companies.findIndex((c) => c.id === input?.id);
    if (i < 0) throw new Error("会社が見つかりません");
    return companyDetailSchema.parse({
      ...companies[i],
      contacts: empty
        ? []
        : contacts
            .filter((_, j) => j % 3 === i)
            .map((c, j) => ({
              ...c,
              title: j === 0 ? "マーケティング担当" : null,
              isPrimary: j === 0,
            })),
    });
  }
  return undefined;
}

import { segmentRowSchema } from "@openengage/core/segments";
const listMemberIds = [
  ["contact-0", "contact-1", "contact-2", "contact-3"],
  ["contact-2", "contact-4", "contact-5"],
  ["contact-0", "contact-6", "contact-7"],
];
const previewLists = ["秋の展示会 来場者", "ウェビナー参加者", "導入企業の担当者"].map((name, i) =>
  segmentRowSchema.parse({
    id: `list-${i}`,
    name,
    slug: `preview-list-${i}`,
    description: [
      "展示会で接点を持った連絡先です。",
      "ウェビナー参加後のフォロー対象です。",
      "導入企業の活用支援を担当する連絡先です。",
    ][i],
    kind: "static",
    filterAst: null,
    membershipSource: ["展示会受付", "参加者インポート", "手動選定"][i],
    filterVersion: 1,
    memberCount: empty ? 0 : listMemberIds[i].length,
    evaluatedAt: null,
    evaluationStatus: "ready",
    evaluationError: null,
    createdAt: "2026-09-01T04:00:00Z",
    updatedAt: "2026-09-12T04:00:00Z",
  }),
);
function listFixture(path: string, input: any) {
  if (path === "segments.list" && input?.kind === "static") return empty ? [] : previewLists;
  if (path === "segments.get" && String(input?.id).startsWith("list-")) {
    const list = previewLists.find((list) => list.id === input.id);
    if (!list) throw new Error("リストが見つかりません");
    return list;
  }
  if (path === "contacts.list" && String(input?.segmentId).startsWith("list-")) {
    const index = previewLists.findIndex((list) => list.id === input.segmentId);
    const items =
      empty || index < 0
        ? []
        : contacts.filter((contact) => listMemberIds[index].includes(contact.id));
    return { items, total: items.length, nextCursor: null };
  }
  return undefined;
}

import { additionalFixture } from "./full-fixtures";
function readBaseFixture(path: string, input: any): any {
  if (path === "dashboard.get") return dashboard;
  for (const handler of [listFixture, companyFixture, reportFixture, extendedFixture, oldFixture]) {
    const data = handler(path, input);
    if (data !== undefined) return data;
  }
  throw new Error(`未定義のプレビューデータ: ${path}`);
}
export function readFixture(path: string, input: any): any {
  return additionalFixture(path, input, readBaseFixture) ?? readBaseFixture(path, input);
}
