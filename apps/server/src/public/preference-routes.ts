import type { Hono } from "hono";

import { ConsentRepository } from "@openengage/database/consent";

import { apiError } from "../auth/access";
import type { AppEnvironment } from "../env";
import { verifySignedToken } from "../platform/crypto";
import { escapeHtml } from "../rendering/html";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";

export function registerPublicPreferenceRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/u/:token", async (context) => {
    const database = context.get("database");
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_unsubscribe_token", "解除リンクが無効です");
    }
    await new ConsentRepository(database, {
      workspaceId: payload.workspaceId,
    }).applyOneClickUnsubscribe(payload.contactId);
    await enqueueSegmentContactReconciliation(context.env.JOBS_QUEUE, payload.workspaceId, [
      payload.contactId,
    ]);
    return context.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><title>配信停止</title><body><main><h1>配信を停止しました</h1><p>設定はすぐに反映されます。</p></main></body></html>',
    );
  });

  publicApp.post("/u/:token", async (context) => {
    return context.redirect(`/u/${encodeURIComponent(context.req.param("token"))}`, 303);
  });

  publicApp.get("/preference/:token", async (context) => {
    const database = context.get("database");
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_preference_token", "設定リンクが無効です");
    }
    const state = await new ConsentRepository(database, {
      workspaceId: payload.workspaceId,
    }).readPreferenceCenterState(payload.contactId);
    const rows = state.topics
      .map(
        (topic) => `<label style="display:block;padding:16px 0;border-bottom:1px solid #e2e8f0">
          <input type="checkbox" name="topic" value="${escapeHtml(topic.id)}" ${topic.status === "subscribed" ? "checked" : ""}>
          <strong>${escapeHtml(topic.name)}</strong>
          <span style="display:block;margin-left:24px;color:#64748b">${escapeHtml(topic.description)}</span>
        </label>`,
      )
      .join("");
    return context.html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>配信設定</title></head>
      <body style="margin:0;background:#f5f7fb;font-family:system-ui;color:#172033"><main style="max-width:640px;margin:48px auto;background:white;padding:32px;border-radius:16px">
      <h1>配信設定</h1><p style="color:#64748b">受け取りたいトピックを選択してください。</p>
      <form method="post">${rows}
      <label style="display:block;padding:20px 0"><input type="checkbox" name="globalStop" ${state.globallySuppressed ? "checked" : ""}> すべてのマーケティングメールを停止</label>
      <button style="border:0;border-radius:10px;background:#6d4aff;color:white;padding:12px 20px;font-weight:700">設定を保存</button>
      </form></main></body></html>`);
  });

  publicApp.post("/preference/:token", async (context) => {
    const database = context.get("database");
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_preference_token", "設定リンクが無効です");
    }
    const form = await context.req.formData();
    const selectedTopicIds = form
      .getAll("topic")
      .filter((value): value is string => typeof value === "string");
    await new ConsentRepository(database, {
      workspaceId: payload.workspaceId,
    }).applyPreferenceCenterUpdate({
      contactId: payload.contactId,
      selectedTopicIds,
      globalStop: Boolean(form.get("globalStop")),
    });
    await enqueueSegmentContactReconciliation(context.env.JOBS_QUEUE, payload.workspaceId, [
      payload.contactId,
    ]);
    return context.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><body><main><h1>設定を保存しました</h1><p>変更は次回の送信判定から反映されます。</p></main></body></html>',
    );
  });
}
