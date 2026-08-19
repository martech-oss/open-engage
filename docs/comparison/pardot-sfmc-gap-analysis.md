# Pardot / Salesforce Marketing Cloud 機能ギャップ分析

商用マーケティングオートメーションの代表格である **Pardot（Marketing Cloud Account Engagement）** と
**Salesforce Marketing Cloud（Marketing Cloud Engagement）** の機能を棚卸しし、
OpenEngage `v0.1` の実装状況と突き合わせた資料です。

- 対象コミット時点の OpenEngage は `v0.1` 開発版です。
- 「実装済 / 部分実装 / 未実装」の判定は **実際のソースコードを根拠** にしています。README の記載ではありません。
- Pardot / SFMC 側はエディションによって利用可否が変わります。詳細は末尾の[注記](#注記)を参照してください。

---

## 目次

1. [Pardot（Marketing Cloud Account Engagement）の機能](#1-pardotmarketing-cloud-account-engagementの機能)
2. [Salesforce Marketing Cloud（Engagement）の機能](#2-salesforce-marketing-cloudengagementの機能)
3. [機能マトリクス](#3-機能マトリクス)
4. [OpenEngage 独自の機能](#4-openengage-独自の機能)
5. [重点ギャップ](#5-重点ギャップ)
6. [既知の制約](#6-既知の制約)
7. [注記](#注記)

---

## 1. Pardot（Marketing Cloud Account Engagement）の機能

B2B 向け MA。2022 年に Pardot から Marketing Cloud Account Engagement へ改称されました。
エディションは Growth / Plus / Advanced / Premium の 4 段階です。

### データ・オーディエンス

- **Prospect 管理** — プロスペクトレコード、カスタムフィールド、アクティビティ履歴、Prospect Audits
- **リスト** — 静的リスト、動的リスト（Dynamic List：条件の変化で自動的に出入り）
- **Segmentation Rules** — 一括セグメント実行
- **Import Wizard / Bulk Actions** — CSV インポート、一括更新
- **Business Units** — 複数事業部でのデータ分離（Plus 以上）
- **Prospect Account** — 会社単位のグルーピング、ABM の基礎

### 集客・獲得

- **Landing Pages** — テンプレート、レイアウトテンプレート（HTML / CSS）
- **Forms** — フォームビルダー、**Progressive Profiling**（既知項目を差し替えて出し分け）、Dependent Fields、Kiosk / Data Entry Mode
- **Form Handlers** — 既存の自社フォームの POST を受け取る方式
- **Files** — ファイルホスティングとダウンロードトラッキング
- **Custom Redirects** — 外部リンクのクリック計測用リダイレクト
- **Page Actions** — 特定 URL の閲覧時にスコア加算・タグ付け
- **Tracker Domains** — 自社ドメインでのファーストパーティ Cookie 計測
- **Visitor Tracking** — 匿名 Visitor から Prospect への紐付け、Visitor Filters

### メール

- **List Email** — 一斉配信、Email Templates、HML（Handlebars Merge Language）
- **A/B テスト** — 件名・本文のスプリットテスト
- **Email Preference Center** — 購読設定センター、オプトアウト管理
- **Sending Options** — 送信元（Assigned User / 特定ユーザー / General User）、返信先の指定
- **Email Rendering Preview / Spam Analysis** — メールクライアント別プレビュー
- **Sales Emails / Engage Campaigns** — 営業からの 1:1 送信、Gmail / Outlook プラグイン、Engage Alerts

### オートメーション

- **Engagement Studio** — ビジュアルドリップ。Action / Trigger / Rule の 3 ノード、待機、分岐、A/B テスト
- **Automation Rules** — 常時評価の if-then（一度だけ、または繰り返し）
- **Completion Actions** — フォーム送信・メールクリック等の直後アクション
- **Dynamic Content** — Prospect 属性によるメール / LP 内の出し分け
- **Scoring & Grading** — 行動スコア（Scoring Rules）、**Scoring Categories**（製品別スコア）、プロファイル評価（Grade A〜F）
- **Einstein Behavior Scoring / Lead Scoring**（Advanced 以上）

### Salesforce 連携

- **Salesforce Connector (v2)** — Lead / Contact / Account / Opportunity の双方向同期、フィールドマッピング
- **Marketing Data Sharing** — 同期対象の絞り込み
- **Connected Campaigns** — Salesforce Campaign との統合、Campaign Member Status 同期
- **Engagement History** — Lightning コンポーネント、Salesforce 側での MA 活動表示
- **Account Engagement Lightning App** — Salesforce UI 内での操作
- **External Actions / External Activities** — 外部システムのイベント取り込み、Salesforce Flow 連携

### 計測・レポート

- 標準レポート（Email / Form / Landing Page / List Email / Lifecycle / Campaign）
- **Campaign Influence / ROI レポート**、Multi-Touch Attribution
- **B2B Marketing Analytics (CRM Analytics)** — Engagement / Pipeline / Attribution ダッシュボード
- **Einstein Campaign Insights / Attribution / Send Time Optimization**
- **Account Engagement Optimizer** — 同期・処理キューの可視化

### 連携・基盤

- Google Analytics / Google Ads、Webinar（GoToWebinar / ON24 / WebEx / Zoom）、Eventbrite、Olark、LinkedIn / X 広告
- **API v5 / Export API**、Bulk API、Webhook（External Actions）
- SSO（SAML）、ユーザーロール、Sandbox（Advanced 以上）、監査ログ
- GDPR / 同意管理、reCAPTCHA・ハニーポット、Do Not Email / Call、Suppression

---

## 2. Salesforce Marketing Cloud（Engagement）の機能

B2C 向け。複数の Studio / Builder の集合体です。

### Studio・Builder 群

| 機能                                         | 内容                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Email Studio**                             | 一斉・トリガー配信、Subscriber / List、Data Extension、Triggered Send、Send Log                                                        |
| **Content Builder**                          | 資産の一元管理（テンプレート、ブロック、画像、コードスニペット）、Business Unit 間共有                                                 |
| **Journey Builder**                          | マルチチャネルジャーニー。Entry Source、Decision Split、Engagement Split、Einstein Split、Wait、Goal、Path Optimizer、Journey Insights |
| **Automation Studio**                        | スケジュール / ファイルドロップ起動、**SQL Query Activity**、Import、File Transfer、Data Extract、Filter、Script（SSJS）、Verification |
| **Contact Builder**                          | Contact データモデル、Attribute Group、リレーション定義、Contact Delete                                                                |
| **Analytics Builder**                        | トラッキング、標準 / Discover レポート、Intelligence Reports、Web / Email Analytics                                                    |
| **Mobile Studio**                            | MobilePush（プッシュ・アプリ内メッセージ・位置情報）、MobileConnect（SMS / MMS）、GroupConnect（LINE / WhatsApp）                      |
| **Advertising Studio**                       | Advertising Audiences（Google / Meta / X / LinkedIn への名簿同期）、Lead Capture                                                       |
| **Web Studio / CloudPages**                  | ランディングページ、マイクロサイト、Smart Capture Form、Interactive Email、Coupon Code                                                 |
| **Personalization**（旧 Interaction Studio） | Web / アプリのリアルタイムパーソナライズ、レコメンド（Einstein Recipes）、行動ストリーム                                               |
| **Intelligence**（旧 Datorama）              | 全チャネルのマーケ投資統合分析、コネクタ、ダッシュボード                                                                               |
| **Data Cloud**（旧 CDP）                     | 統合プロファイル、Identity Resolution、Calculated Insights、セグメント、Activation                                                     |
| ~~Social Studio~~                            | 2024 年 11 月にサービス終了                                                                                                            |

### パーソナライズ・開発

- **AMPscript / SSJS / GTL** — メール・CloudPages 内の動的処理
- **Dynamic Content / Content Blocks**、Einstein Content Selection
- **REST API / SOAP API**、Transactional Messaging API、Package Manager、Installed Package、Journey Builder API、SDK（iOS / Android / Web）
- **Marketing Cloud Connect** — Sales / Service Cloud 連携（Salesforce Campaign、Report 送信、Object Triggered Send）
- **Distributed Marketing** — 代理店・営業・フランチャイズによる分散配信

### Einstein / AI

Engagement Scoring、Send Time Optimization、Copy Insights、Content Selection、Messaging Insights、Engagement Frequency、Recommendation（Email / Web）

### 配信基盤・管理

- **Business Units（Enterprise 2.0）**、ロール / 権限、共有設定
- **Sender Authentication Package**（専用 IP、SPF / DKIM、リンクブランディング）、IP Warming
- **Sender Profile / Send Classification / Delivery Profile** — Commercial と Transactional の分離
- **Reply Mail Management**（自動返信・バウンス処理）、List Detective
- **Suppression List / Exclusion Script / All Subscribers / Unsubscribe**（Business Unit 単位または全体）
- Data Retention Policy、Field-Level Encryption、監査ログ、配信性能モニタリング

### 新エディション（Core Platform 系）

**Marketing Cloud Growth / Advanced** — Salesforce Core プラットフォーム上に Data Cloud を前提として再構築。
Flow ベースのキャンペーン、セグメント、Agentforce Campaigns、生成 AI によるメール / 件名生成、Path Experiments（Advanced）。

---

## 3. 機能マトリクス

判定は次の 3 値です。

- ✅ **実装済** — 機能として利用できる
- ⚠️ **部分実装** — 一部だけ存在する、または動作しない箇所がある（詳細は[6. 既知の制約](#6-既知の制約)）
- ❌ **未実装**

### データ・オーディエンス

| 機能                                        | Pardot | SFMC | OpenEngage | 根拠                                                                                                       |
| ------------------------------------------- | :----: | :--: | :--------: | ---------------------------------------------------------------------------------------------------------- |
| コンタクト管理・カスタムフィールド          |   ✅   |  ✅  |     ✅     | `packages/database/src/contacts/schema.ts`                                                                 |
| 会社（Account）管理                         |   ✅   |  ✅  |     ✅     | `packages/database/src/contacts/schema.ts`（`companies`, `companyContacts`）                               |
| タグ                                        |   ✅   |  ✅  |     ✅     | `packages/database/src/contacts/schema.ts`（`tags`, `contactTags`）                                        |
| 行動イベント履歴                            |   ✅   |  ✅  |     ✅     | `packages/database/src/contacts/schema.ts`（`contactEvents`）                                              |
| 静的リスト                                  |   ✅   |  ✅  |     ✅     | `packages/database/src/segments/schema.ts`（`kind: "static"`）                                             |
| 動的セグメント（AND / OR ネスト）           |   ✅   |  ✅  |     ✅     | `packages/core/src/segments/schema.ts`、13 フィールド × 11 演算子は `packages/core/src/segments/fields.ts` |
| セグメントの自動再評価                      |   ✅   |  ✅  |     ✅     | `apps/server/src/segments/reconciliation-queue.ts`, `apps/server/src/segments/membership-service.ts`       |
| CSV インポート / エクスポート               |   ✅   |  ✅  |     ✅     | `apps/server/src/contacts/import-export-service.ts`, `apps/server/src/contacts/csv.ts`                     |
| マルチテナント（Business Unit / Workspace） |   ✅   |  ✅  |     ✅     | `packages/database/src/auth/schema.ts`（`organization`）                                                   |

### 集客・獲得

| 機能                                       | Pardot | SFMC | OpenEngage | 根拠                                                                                                                                |
| ------------------------------------------ | :----: | :--: | :--------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| フォームビルダー                           |   ✅   |  ✅  |     ✅     | `apps/client/src/features/website/form-field-builder.tsx`                                                                           |
| フォームでのカスタムフィールド収集         |   ✅   |  ✅  |     ✅     | `packages/core/src/web/schema.ts` `formFieldSchema`、`apps/server/src/public/templates.ts`                                          |
| Progressive Profiling / 条件付きフィールド |   ✅   |  ✅  |     ⚠️     | `apps/server/src/public/templates.ts` `selectFields`。回答済み項目を出し分ける。条件付き表示（依存フィールド）は未対応              |
| Bot 対策                                   |   ✅   |  ✅  |     ✅     | Turnstile（`packages/core/src/web/schema.ts` `turnstileEnabled`）                                                                   |
| 許可ドメイン制限                           |   ✅   |  ✅  |     ✅     | `apps/server/src/web/domain.ts`                                                                                                     |
| ランディングページ（版管理）               |   ✅   |  ✅  |     ✅     | `packages/database/src/web/schema.ts`（`landingPages`, `landingPageVersions`）                                                      |
| ポップアップ / サイトメッセージ            |   ➖   |  ✅  |     ✅     | `packages/database/src/web/schema.ts`（`siteMessages`）、`apps/server/src/public/site-message-routes.ts`                            |
| ファイル / Asset ホスティング              |   ✅   |  ✅  |     ✅     | `packages/database/src/assets/schema.ts`（`assets`）、`apps/server/src/assets/service.ts`                                           |
| Web トラッキング（匿名 Visitor 紐付け）    |   ✅   |  ✅  |     ✅     | `apps/server/src/public/tracking-routes.ts` — 同意必須（`consent: z.literal(true)`）                                                |
| Custom Redirect（外部リンク計測）          |   ✅   |  ✅  |     ✅     | `packages/database/src/web/custom-redirect-repository.ts`、`apps/server/src/public/custom-redirect-routes.ts`（`GET /r/:ws/:slug`） |
| Page Action（URL 閲覧での自動加点）        |   ✅   |  ➖  |     ✅     | `scoring_rules` の `page_viewed` × URL 一致（`apps/server/src/scoring/engine.ts`）                                                  |

### メール

| 機能                                   | Pardot | SFMC | OpenEngage | 根拠                                                                                                                                                                    |
| -------------------------------------- | :----: | :--: | :--------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transactional 配信                     |   ✅   |  ✅  |     ✅     | `apps/server/src/messaging/cloudflare-email.ts`, `apps/server/src/messaging/delivery-worker.ts`                                                                         |
| Marketing 一斉配信（ブロードキャスト） |   ✅   |  ✅  |     ❌     | 型に `marketing` はあるが（`packages/core/src/shared/schema.ts` `MESSAGE_PURPOSES`）、router は template CRUD のみ（`apps/server/src/messaging/router.ts`）             |
| メールテンプレート                     |   ✅   |  ✅  |     ✅     | `packages/database/src/messaging/schema.ts`（`emailTemplates`）                                                                                                         |
| ブランド設定                           |   ✅   |  ✅  |     ✅     | 同上（`emailBrandProfiles`）                                                                                                                                            |
| マージ変数                             |   ✅   |  ✅  |     ✅     | 同上（`messageVariables`）、`apps/server/src/rendering/content-renderer.ts`                                                                                             |
| A/B テスト                             |   ✅   |  ✅  |     ❌     | 該当実装なし                                                                                                                                                            |
| Dynamic Content（本文の出し分け）      |   ✅   |  ✅  |     ❌     | 該当実装なし                                                                                                                                                            |
| Preference Center（購読設定）          |   ✅   |  ✅  |     ✅     | `apps/server/src/public/preference-routes.ts`（`/u/:token`, `/preference/:token`）                                                                                      |
| 購読トピック                           |   ✅   |  ✅  |     ✅     | `packages/database/src/consent/schema.ts`（`subscriptionTopics`, `contactSubscriptions`）                                                                               |
| Suppression / 全停止                   |   ✅   |  ✅  |     ✅     | 同上（`suppressions`）、`consentEvents`                                                                                                                                 |
| バウンス / 苦情の取り込み              |   ✅   |  ✅  |     ✅     | `apps/server/src/messaging/cloudflare-events.ts`                                                                                                                        |
| **開封計測**                           |   ✅   |  ✅  |     ✅     | `apps/server/src/messaging/email-tracking.ts`（ピクセル埋め込み）、`apps/server/src/public/email-tracking-routes.ts`（`GET /t/:token`）。Workspace設定でON/OFF、既定OFF |
| **クリック計測**                       |   ✅   |  ✅  |     ⚠️     | 同上（`GET /c/:token`）。HTML本文のみ。プレーンテキストは書き換えない                                                                                                   |
| 受信メール（返信の取り込み）           |   ✅   |  ✅  |     ✅     | `apps/server/src/messaging/inbound-worker.ts`, `apps/server/src/messaging/reply-address.ts`                                                                             |
| 専用 IP / IP ウォームアップ / 送信分類 |   ➖   |  ✅  |     ❌     | Cloudflare Email Service に依存、制御 API なし                                                                                                                          |

### オートメーション

| 機能                                       | Pardot | SFMC | OpenEngage | 根拠                                                                                                                    |
| ------------------------------------------ | :----: | :--: | :--------: | ----------------------------------------------------------------------------------------------------------------------- |
| ビジュアルビルダー                         |   ✅   |  ✅  |     ✅     | `packages/core/src/automations/schema.ts` — source / action / condition / decision / delay の 5 ノード、最大 500 ノード |
| 起動トリガー                               |   ✅   |  ✅  |     ✅     | 6 種（`segment_joined` / `form_submitted` / `contact_created` / `api_event` / `webhook_event` / `contact_inactive`）    |
| 再入制御（once / every_time）              |   ✅   |  ✅  |     ✅     | `sourceNodeSchema` の `reentry`                                                                                         |
| アクション                                 |   ✅   |  ✅  |     ✅     | 8 種（`send_email` / `send_webhook` / タグ追加・削除 / セグメント追加・削除 / `change_score` / `update_field`）         |
| 待機（相対 / 絶対 / 時間帯ウィンドウ）     |   ✅   |  ✅  |     ✅     | `delayNodeSchema`                                                                                                       |
| 属性による条件分岐                         |   ✅   |  ✅  |     ✅     | `conditionNodeSchema`（セグメントと同じ演算子を再利用）                                                                 |
| 行動による分岐（開封 / クリック待ち）      |   ✅   |  ✅  |     ✅     | `decisionNodeSchema` + `apps/server/src/automations/worker.ts`。計測が有効なら `yes` 分岐が成立する                     |
| 実行の中断・再開                           |   ✅   |  ✅  |     ✅     | `packages/database/src/automations/schema.ts`（`automationEnrollments`, `automationJobs`）+ Queues / Cron               |
| 常時評価の if-then（Automation Rule 相当） |   ✅   |  ➖  |     ❌     | トリガー起動のみ                                                                                                        |
| スコアリング（加点）                       |   ✅   |  ✅  |     ✅     | ルールエンジン（`apps/server/src/scoring/engine.ts`）とオートメーションの `change_score` の両方                         |
| スコアリングルール（自動加点の定義）       |   ✅   |  ➖  |     ✅     | `packages/database/src/scoring/schema.ts` `scoringRules`                                                                |
| カテゴリ別スコア                           |   ✅   |  ➖  |     ✅     | `scoringCategories` / `contactCategoryScores`                                                                           |
| グレード（A〜F）                           |   ✅   |  ➖  |     ✅     | `gradingCriteria` + `contacts.grade_points`、`packages/core/src/scoring/grade.ts`                                       |

### レポート・連携・基盤

| 機能                                                               | Pardot | SFMC | OpenEngage | 根拠                                                                                                                           |
| ------------------------------------------------------------------ | :----: | :--: | :--------: | ------------------------------------------------------------------------------------------------------------------------------ |
| ダッシュボード                                                     |   ✅   |  ✅  |     ✅     | `apps/server/src/reports/dashboard-service.ts`                                                                                 |
| レポート（コンタクト / オートメーション / メール / 商談 / サイト） |   ✅   |  ✅  |     ✅     | `apps/server/src/reports/`, `packages/core/src/reports/schema.ts`                                                              |
| 開封率・クリック率                                                 |   ✅   |  ✅  |     ✅     | `apps/server/src/reports/emails-report.ts`。`delivery_events` の `opened`/`clicked` から集計                                   |
| キャンペーン / アトリビューション / ROI                            |   ✅   |  ✅  |     ✅     | 既存 `projects` を拡張。`campaign_touches` と `apps/server/src/reports/campaigns-report.ts`（関与 / 初回接点 / 最終接点）      |
| CRM 連携（Salesforce 等）                                          |   ✅   |  ✅  |     ❌     | 外部 CRM コネクタなし（自前の Deals CRM を内蔵）                                                                               |
| Webhook 送信                                                       |   ✅   |  ✅  |     ✅     | `packages/database/src/workspaces/schema.ts`（`webhookEndpoints`, `webhookDeliveries`）、`apps/server/src/channels/webhook.ts` |
| REST API / SDK                                                     |   ✅   |  ✅  |     ✅     | `apps/server/src/orpc/openapi-handler.ts`, `packages/sdk/`                                                                     |
| API キー                                                           |   ✅   |  ✅  |     ✅     | `packages/database/src/workspaces/schema.ts`（`apiKeys`）                                                                      |
| SSO / MFA                                                          |   ✅   |  ✅  |     ⚠️     | TOTP は実装済（`packages/database/src/auth/schema.ts` `twoFactor`）、SAML SSO は未実装                                         |
| ロールベース権限                                                   |   ✅   |  ✅  |     ✅     | `packages/core/src/shared/schema.ts`（`WORKSPACE_ROLES` = owner / admin / marketer / analyst / viewer）                        |
| 監査ログ                                                           |   ✅   |  ✅  |     ✅     | `packages/database/src/platform/schema.ts`（`auditLogs`）                                                                      |
| SMS / Push / LINE / WhatsApp                                       |   ➖   |  ✅  |     ❌     | `CHANNELS` は `email` / `webhook` のみ（`packages/core/src/shared/schema.ts`）                                                 |
| 広告オーディエンス連携                                             |   ✅   |  ✅  |     ❌     | 該当実装なし                                                                                                                   |

---

## 4. OpenEngage 独自の機能

Pardot / SFMC に直接対応する機能が無い、あるいは提供形態が大きく異なるものです。

| 機能                                 | 内容                                                                     | 根拠                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **AI Email Sequence Designer**       | 目的・対象から、メール文面・配信間隔・分岐・終了条件までを一括で下書き化 | `apps/server/src/automations/email-sequence-service.ts`, `packages/core/src/automations/email-sequence.ts`   |
| **AI セグメント生成**                | 自然言語からセグメント条件（AST）を生成                                  | `apps/server/src/segments/generation-service.ts`                                                             |
| **AI 企業情報エンリッチメント**      | AI Gateway Web Search と Browser Run で根拠付きの候補を作成              | `apps/server/src/contacts/company-enrichment-service.ts`                                                     |
| **AI メール画像生成**                | メール用の画像を生成し R2 に保存                                         | `apps/server/src/messaging/email-image-generation-service.ts`                                                |
| **Deals CRM 内蔵**                   | ステージ型パイプライン、商談、営業タスクを外部 CRM 無しで管理            | `packages/database/src/deals/schema.ts`                                                                      |
| **Project Brief**                    | 施策ブリーフの生成・版管理・レビュー                                     | `packages/database/src/projects/schema.ts`（`projectBriefs`, `projectBriefVersions`, `projectBriefReviews`） |
| **Remote MCP エンドポイント**        | AI エージェントから直接ワークスペースを操作                              | `apps/server/src/mcp/`                                                                                       |
| **単一 Cloudflare アカウントで完結** | D1 / R2 / Queues / Workers のみで動作し、外部 SaaS 依存なし              | `apps/server/`, `apps/agent/`, `apps/client/`                                                                |

---

## 5. 重点ギャップ

Phase 1〜5 で 7 項目中 6 項目を実装しました。残るのは配信そのものに関わる 2 項目です。

| #   | ギャップ                           | 影響                                                                               | 依存 |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------- | ---- |
| 1   | **Marketing ブロードキャスト配信** | 「メールを一斉に送る」基本用途を満たせない。現在の配信はすべてオートメーション経由 | —    |
| 5   | **A/B テスト**                     | 件名・本文の最適化ができない                                                       | 1    |

### 実装済みになった項目

| #   | 項目                                                 | Phase | 実装                                                                          |
| --- | ---------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| 2   | 開封・クリック計測                                   | 1     | ピクセルとリンク書き換え、Workspace設定でON/OFF                               |
| 6   | Custom Redirect / Page Action                        | 2, 3  | `/r/:ws/:slug` の計測用リンクと、`page_viewed` × URL 一致のスコアリングルール |
| 3   | スコアリングルール / カテゴリ / グレード             | 3     | イベント駆動のルールエンジン、カテゴリ別スコア、D基準の3分の1文字刻みグレード |
| 4   | フォームのカスタムフィールド / Progressive Profiling | 4     | `custom:<key>` 名前空間と、回答済み項目の出し分け                             |
| 7   | キャンペーン / アトリビューション / ROI              | 5     | 既存 `projects` を campaign として拡張し、関与 / 初回接点 / 最終接点を算出    |

残る 1 が実装されれば 5 も成立し、Pardot / SFMC との主要な機能差はほぼ解消します。

---

## 6. 既知の制約

初版で挙げた不整合（開封ピクセルの孤立、リンク書き換えの不在、常に 0 のレポート指標、
必ず timeout に落ちる decision ノード、README との差分）は Phase 1 で解消しました。
現在残っているのは、実装方式そのものに由来する制約です。

### 6.1 プレーンテキスト版のクリックは計測されない

リンク書き換えは `render()` 後の HTML にのみ適用し、`toPlainText()` は書き換え前の HTML から
生成しています（`apps/server/src/messaging/email-tracking.ts`）。
本文の可読性を優先した判断ですが、HTML を表示しない受信者のクリックは記録されません。

### 6.2 開封数は構造的に過大計上される

Apple Mail のプライバシー保護は受信時に画像を先読みするため、実際に読まれていない開封が計上されます。
同様に、企業のリンク検査は人の操作なしにクリック URL へアクセスします。
同一 Delivery の重複は一意制約で排除していますが（開封は初回のみ、クリックは遷移先 URL ごとに 1 回）、
これらの過大計上は排除できません。絶対値ではなく相対比較の指標として扱う必要があります。

### 6.3 計測は既定で無効

`email_tracking_settings` の 2 つのトグルはどちらも既定 OFF です。
有効化するまでレポートの開封率・クリック率は 0% のままで、decision ノードは `timeout` 側へ流れます。
これは同意重視の既定値として意図したものですが、運用開始時の設定漏れに注意が必要です。

### 6.4 計測用リンクの匿名クリックは連絡先に紐付かない

`/r/:ws/:slug` はサイトトラッキングが付与する `oe_v` の訪問者IDで連絡先を特定します
（`apps/server/src/public/custom-redirect-routes.ts`）。
メール本文やSNSから直接踏まれた場合はIDが無く、クリック数だけが増えて
タイムライン・スコア・アトリビューションには反映されません。

### 6.5 Page Action はサイトトラッキングに依存する

`page_viewed` を条件にしたスコアリングルールは、サイトトラッキングが有効で
訪問者が同意している場合にのみ発火します。トラッキング未導入のサイトでは動きません。

### 6.6 グレードの再計算はイベント駆動

`recomputeContactGrade` はスコア対象イベントの発生時と連絡先の更新時に走ります
（`apps/server/src/scoring/engine.ts`）。
グレード条件を後から追加・変更しても、既存の連絡先は次にイベントが発生するまで
古いグレードのままです。一括再計算のジョブは未実装です。

### 6.7 アトリビューションはプロジェクト紐付けが前提

接点は `project_items` に登録されたリソースへの反応だけを記録します
（`packages/database/src/web/campaign-repository.ts`）。
プロジェクトに紐付けていないメールやフォームは、どれだけ反応があっても
キャンペーンレポートには現れません。また、ページ閲覧は URL がリソースIDではないため
接点になりません。

### 6.8 Progressive Profiling に条件付きフィールドは無い

未回答の項目を順に出す方式のみで、Pardot の Dependent Fields
（ある回答を選んだときだけ別の項目を出す）には対応していません。

---

## 注記

- **改称について** — Pardot は 2022 年に Marketing Cloud Account Engagement へ、
  Datorama は Marketing Cloud Intelligence へ、Interaction Studio は Marketing Cloud Personalization へ、
  Salesforce CDP は Data Cloud へそれぞれ改称されています。Social Studio は 2024 年 11 月にサービス終了しました。
- **エディション差** — 上記の機能一覧には上位エディション限定のものが含まれます
  （Pardot の Sandbox・Einstein 系は Advanced 以上、Business Units は Plus 以上など）。
- **新エディション** — Marketing Cloud Growth / Advanced は従来の Marketing Cloud Engagement とは
  別アーキテクチャ（Salesforce Core + Data Cloud）で、機能セットも異なります。
- **➖ の意味** — マトリクス中の ➖ は「その製品では該当機能が主要な提供単位になっていない」ことを示します。
  完全に不可能という意味ではありません。
