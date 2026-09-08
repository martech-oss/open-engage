// Development fixture, installed through the same public management API as integrations.
const base = new URL(process.env.OPENENGAGE_DEMO_BASE_URL ?? "http://localhost:8787");
const apiKey = process.env.OPENENGAGE_DEMO_API_KEY;
if (!apiKey)
  throw new Error(
    "Set OPENENGAGE_DEMO_API_KEY to a local development workspace's marketer/admin API key.",
  );
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  throw new Error("This development fixture only runs against localhost.");
async function request(path, method = "GET", body) {
  const response = await fetch(new URL(`/api/v1${path}`, base), {
    method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} failed (${response.status}): ${await response.text()}`);
  return response.json();
}
const name = "OpenEngage 開発デモ";
const projects = await request("/projects");
if (projects.some((project) => project.name === name)) {
  console.log("Development demo already exists; no additional records were created.");
} else {
  const project = await request("/projects", "POST", {
    name,
    description: "LP・営業進捗・ROIの開発用データ",
    color: "#0f766e",
  });
  const page = await request("/website/pages", "POST", {
    name: "お問い合わせデモ",
    slug: "demo-marketing",
    status: "draft",
    document: {
      schemaVersion: 1,
      title: "OpenEngage デモ",
      description: "開発環境用の問い合わせページ",
      html: '<main><h1>サービスについて相談する</h1><div data-oe-dynamic="intro"></div><div data-oe-form="contact"></div></main>',
      css: "body{margin:0;font-family:system-ui,sans-serif;color:#17202a;background:#f7faf9}main{max-width:48rem;margin:auto;padding:3rem 1rem}h1{font-size:2rem}",
      forms: [
        {
          refId: "contact",
          name: "お問い合わせ",
          definition: {
            fields: [{ key: "email", kind: "standard", type: "email", required: true }],
          },
          successMessage: "お問い合わせありがとうございます。",
          turnstileEnabled: false,
        },
      ],
      ctas: [],
      images: [],
      dynamicSlots: [{ refId: "intro", fallbackHtml: "<p>ご相談内容をお寄せください。</p>" }],
      measurement: { projectId: project.id, primaryConversion: "form_submitted" },
    },
  });
  await request(`/website/pages/${page.id}/publish`, "POST", {
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  await request(`/projects/${project.id}/costs`, "POST", {
    costId: crypto.randomUUID(),
    bookedOn: new Date().toISOString().slice(0, 10),
    category: "広告（デモ）",
    amount: 10000,
    currency: "JPY",
  });
  const members = await request("/sales/members");
  const options = await request("/deals/options");
  const pipeline = options.pipelines[0];
  for (const stage of ["lead", "mql", "sql", "customer"]) {
    const contact = await request("/contacts", "POST", {
      email: `demo-${stage}@example.invalid`,
      firstName: `デモ ${stage}`,
      customFields: {},
    });
    if (stage !== "lead" && members[0])
      await request("/sales/handoff", "POST", {
        contactId: contact.id,
        executionKey: `demo:${contact.id}`,
        ownerUserId: members[0].id,
        title: "デモ連絡先へ連絡する",
      });
    if (["sql", "customer"].includes(stage) && pipeline?.stages[0]) {
      const deal = await request("/deals", "POST", {
        name: `デモ商談 ${stage}`,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
        currency: "JPY",
        value: 50000,
      });
      if (stage === "customer") await request(`/deals/${deal.id}`, "PATCH", { status: "won" });
    }
  }
  console.log(`Created development demo project ${project.id} and page ${page.id}.`);
}
