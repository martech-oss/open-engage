# OpenEngage

Cloudflare上で完結する、オープンソースのマーケティングオートメーション基盤です。

Mauticの「Contact・Segment・Form・Content・Score・Automation・計測」という考え方を、TypeScriptとCloudflare Workers向けに再構築しています。Mautic APIやPHPプラグインとの互換性は目的としていません。

> [!IMPORTANT]
> 現在は `v0.1` の開発版です。本番投入前に、Cloudflare Email Sendingの送信ドメイン、同意要件、負荷特性、バックアップ手順を環境ごとに検証してください。

## 特徴

- TanStack Startの公開Worker、内部API Worker、非公開Flue Agent WorkerをService Bindingで分離
- D1を業務データとオートメーション状態機械の正本として使用
- R2によるAsset、CSV、受信添付ファイル、イベントアーカイブの保存
- 画像・eBook・スライドを管理するAssetライブラリと、Worker経由の公開URL配信
- Queuesと1分Cronによる再開可能なオートメーション実行
- Cloudflare Email ServiceによるTransactionalメール
- React Emailで管理する認証メールと、OpenEngage内で管理・公開するWorkspaceテンプレート
- React Flowを使ったビジュアルオートメーションビルダー
- メール文面・間隔・分岐・終了条件をまとめて下書き化するAI Email Sequence Designer
- AI Gateway Web SearchとBrowser Runで根拠付き候補を作る会社情報エンリッチメント
- ステージ型パイプライン、商談、営業タスクを管理するDeals CRM
- Automationメールの開封・クリックを自前で計測する、Workspace単位のオプトイン機能
- 広告・SNS向けの計測用リンク（Custom Redirect）と、URL条件で加点するPage Action
- 行動スコアのルールエンジン、製品別のカテゴリスコア、属性で決まるA〜Fグレード
- カスタムフィールドを収集し、既知の項目を出し分けるProgressive Profiling対応フォーム
- Projectをキャンペーンとして扱い、関与・初回接点・最終接点で受注金額を配分するアトリビューション
- Topic別購読、グローバル配信停止、Suppressionを扱うPreference Center
- Contact・Automation・Email・Deals・Site・キャンペーンを横断するReporting
- Better Authのメール認証、Organization、RBAC、任意のTOTP
- Workspace限定APIキー、TypeScript SDK、Remote MCP endpoint
- 対話式セットアップ、`doctor`、`backup`、`update` CLI

## メール送信ポリシー

OpenEngageはメールの用途を型と実行時検証の両方で分離します。

| 用途            | プロバイダー             | 使用例                                             |
| --------------- | ------------------------ | -------------------------------------------------- |
| `transactional` | Cloudflare Email Service | メール確認、招待、パスワード再設定、Automation通知 |
| `marketing`     | 未実装                   | v0.1では提供しません                               |

Cloudflare Email ServiceはTransactional専用として扱います。Marketing Campaign/BroadcastのAPI・DB・Queue実装はv0.1に含みません。

認証メールはReact Email、WorkspaceのAutomationメールは`ContentDocument`からOpenEngage内でHTMLとplain textを生成します。Automationは公開済みsnapshotだけを使用し、生成済みの件名・HTML・textをDeliveryへ保存してからQueueへ投入します。送信後の`delivered`、`deferred`、`bounced`、`failed`、`rejected`、`complained`はCloudflare QueuesのEmail Sending event subscriptionで取り込みます。`opened`と`clicked`はCloudflare側から通知されないため、OpenEngageが自前で計測します。詳細は[開封・クリック計測](#開封クリック計測)を参照してください。

## アーキテクチャ

```mermaid
flowchart LR
    A["管理者・マーケター"] --> C["Client Worker<br>TanStack Start"]
    V["訪問者・フォーム・Tracking"] --> C
    C -->|"Service Binding"| S["Server Worker<br>Hono / oRPC / REST"]
    S -->|"AGENT_APP Fetch Binding"| AG["Agent Worker<br>Flue / Durable Objects"]
    CR["Cron Scheduler"] --> S
    S --> D["D1<br>業務データ・実行状態"]
    S --> R["R2<br>Asset・CSV・Archive"]
    S --> Q["Queues<br>Automation・Delivery"]
    Q --> S
    S --> ES["Cloudflare Email Service<br>EMAIL Binding / Transactional"]
    ES --> EQ["Email Sending events<br>Queue subscription"]
    EQ --> S
    S --> WH["Outbound Webhook"]
    ER["Cloudflare Email Routing"] --> S
```

長時間のDelayはQueueに保持せず、D1の`automation_jobs.due_at`に保存します。Cronが期限到達Jobをleaseし、Queueへ渡します。Queue consumerは送信直前に同意、抑止、購読Topic、頻度上限、キャンセル状態を再確認します。

## リポジトリ構成

```text
apps/
  client/                公開Worker、TanStack Start/Query、Vite、Tailwind、React Flow
  server/                内部API Worker、Hono、MCP、Cron、Queue、Channel、Renderer、Email Routing
  agent/                 非公開Flue Agent Worker、Durable Objects
packages/
  orpc/                  ドメイン別のoRPC contractと通信固有DTO
  core/                  業務型・Zod schema・純粋ロジックの正本
  create-openengage/     Setup、doctor、backup、update CLI
  database/              Drizzle schema/client、D1 migration、repository
  sdk/                   contract型付きTypeScript SDK
```

Channel adapter、安全なHTML/Text renderer、認証メール用React Email templateは、利用元が
Server Workerに限られるため、それぞれ`apps/server/src/channels`、`rendering`、
`auth/email-templates`で管理します。

`apps/server/src`と`packages/database/src`は同じ15ドメインで一致します:
agents / assets / auth / automations / consent / contacts / deals / messaging /
platform / projects / reports / scoring / segments / web / workspaces
(+ `apps/server/src`だけが持つserver専用の`runtime`, `public`, `orpc`)。

`packages/orpc/src`はほぼ同じですが、`auth`(Better Authが直接APIを提供するためcontract化していない)、
`platform`(`operations`contractに統合)を持たず、
代わりに`assets`、`operations`、`projects`、横断的な`shared`があります。
`companies`はcontacts配下の`company-contract.ts`/`company-schema.ts`として存在し、独立ドメインではありません。

### router / service / repository の責務

`apps/server/src/<domain>/router.ts`は原則`packages/database`の`*Repository`を直接呼びます。
`service.ts`は本物のオーケストレーション(複数ステップ、監査ログ、外部I/O、DTOに収まらない計算)が
あるドメインだけに存在します: `assets/service.ts`(R2・checksum・content-typeポリシー)、
`projects/project-brief-service.ts`(施策ブリーフの状態遷移)、
`deals/service.ts`(参照検証・get-after-write)、`auth/service.ts`(Better Auth設定)、
`mcp/`(ツール実行の集約)。単なる1行委譲(`return new XRepository(...).method(...)`)や
レコード→DTOのフィールドコピーは、前者はrouterへインライン化し、後者はrepository側で
`coreSchema.parse(...)`を返すこと(`packages/database/src/contacts/repository.ts`の`toContact`が参考実装)。

### apps/client のUI・データ層規約

`components/app-ui/`はドメインを問わない共有UIコンポーネントです。新しい画面を作る前に
まずここを確認してください:

| ファイル          | 内容                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- |
| `layout.tsx`      | `PageHeader`, `PageLayout`(ページ共通の見出し+アクション枠)                           |
| `metrics.tsx`     | `MetricGrid`, `MetricCard`(サマリーカードのグリッド)                                  |
| `resources.tsx`   | `ResourceGrid`, `ResourceCard`(カード一覧のグリッド)                                  |
| `form-fields.tsx` | `FormInput`, `FormTextarea`, `FormNativeSelect`(ラベル+エラー表示付きフォーム部品)    |
| `dialogs.tsx`     | `AppDialog`, `FormDialog`, `ConfirmDialog`, `ArchiveConfirm`(確認/フォームダイアログ) |
| `feedback.tsx`    | `EmptyState`, `SimpleEmpty`, `ErrorAlert`, `SuccessAlert`, `LoadingButton`            |
| `copy-button.tsx` | `CopyButton`(値または埋め込みコードのコピー)                                          |
| `bar-chart.tsx`   | `SimpleBarChart`(日次バーチャート、recharts配線を隠蔽)                                |

`features/<domain>/resource-page.tsx`のような、特定ドメイン専用のページ合成コンポーネント
(例: `features/website/resource-page.tsx`の`WebsiteResourceListPage`)はここには置きません。
差分の大部分が列定義やフォーム本体でpropsに残る場合は、無理にapp-ui化せず機能ドメイン側に
置いてください(将来の分岐に耐えない巨大な設定propsノブ化を避けるため)。

`hooks/`は特定ドメインに依存しない汎用ロジックです:

| ファイル                   | 内容                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `use-form-submission.ts`   | `useFormSubmission`(busy/error state付きsubmit)、`getErrorMessage(error, fallback)`           |
| `use-resource-editor.ts`   | `useResourceEditor`(作成/編集ダイアログのopen状態)、`saveResource`(作成/更新の振り分け+toast) |
| `use-debounced-search.ts`  | `useDebouncedSearch`(検索語のデバウンス、内部でref保持しコールバックのメモ化を要求しない)     |
| `use-cursor-pagination.ts` | `useCursorPagination`(カーソルページネーションの前へ/次へ状態)                                |
| `use-mobile.ts`            | `useIsMobile`                                                                                 |

各`features/<domain>/<domain>-api.ts`は、その機能ドメインがoRPCとやり取りする唯一の窓口です:

- 一覧・詳細取得は`<domain>QueryOptions(...)`という名前でTanStack Queryの`queryOptions`を返す
  (コンポーネント側は`useSuspenseQuery`/`useQuery`に渡すだけで、`orpcQuery`を直接importしない)。
- 作成・更新・削除は`use<Verb><Domain>()`という名前のhookにし、内部で`useMutation`を呼び、
  意味のあるキャッシュ無効化を`onSuccess`に持たせる。単純なCRUD(作成・更新・アーカイブ)は
  built-in invalidationを持たせ、複数ステップの操作の一部(例: 連絡先作成の直後にタグ・会社を
  割り当てる)は無効化を呼び出し側に委ねる薄いhookにし、理由を一行コメントで残す
  (`features/contacts/contact-api.ts`の`useCreateContact`が参考実装)。
- コンポーネント(`.tsx`)から`orpc`/`orpcQuery`を直接importしないこと。
  `scripts/check-architecture.mjs`がこれを機械的に強制します。

ルートの`loader`は`context.queryClient.ensureQueryData(<domain>QueryOptions(...))`で
React Queryのキャッシュを温め、コンポーネント側は`Route.useLoaderData()`ではなく
同じ`queryOptions`を渡した`useSuspenseQuery`でデータを読みます(`routes/_app.website.pages.tsx`が
参考実装)。`pendingComponent`/`errorComponent`は個々のルートで書かず、
`components/route-status.tsx`の`routeStatusComponents`をspreadしてください。

## 必要環境

- Node.js 22.12以上
- pnpm 11
- Cloudflareアカウント
- Workers Paidプラン
- D1、R2、Queues
- Cloudflare DNS上のドメインとCloudflare Email Sendingのonboarding
- 受信メールを利用する場合はCloudflare Email Routing

## ローカル開発

### 1. 依存関係

```bash
pnpm install
```

### 2. 開発用Secret

```bash
cp .dev.vars.example apps/server/.dev.vars
```

少なくとも次の値を設定します。

```dotenv
BETTER_AUTH_SECRET=32文字以上のランダム値
CREDENTIAL_ENCRYPTION_KEY=32バイト相当のランダム値
TRACKING_SIGNING_SECRET=32文字以上のランダム値
TURNSTILE_SITE_KEY=Turnstileの公開サイトキー（任意）
TURNSTILE_SECRET=Turnstileのシークレット（任意）
```

`CREDENTIAL_ENCRYPTION_KEY`は、Outbound Webhookの署名資格情報をD1へ保存する際のAES-GCMマスターキーです。運用開始後に不用意に変更すると、保存済み資格情報を復号できなくなります。
Turnstileをフォームで有効にする場合は、`TURNSTILE_SITE_KEY`と`TURNSTILE_SECRET`の両方が必要です。片方だけの設定では公開フォームはfail closedになります。
Email SendingはAPI keyやSecretを使わず、Server Workerの`EMAIL` bindingを利用します。ローカル設定は`remote: true`を指定していないため、メールを実送信せずWranglerのシミュレーターが受け取ります。

### 3. D1 migration

```bash
pnpm db:migrate:local
```

アプリケーションからのDBアクセスは`@openengage/database`のDrizzle clientへ統一しています。
テーブル定義は`packages/database/src/<domain>/schema.ts`(ドメイン別)が正本です。
スキーマ変更時は次のコマンドでDrizzle Kitがmigration SQLを生成します。

```bash
pnpm db:generate
```

Wranglerが適用するSQLは`packages/database/migrations`にDrizzle Kitが直接生成します。
手書きmigrationは廃止しました。`v0.1`開発中はmigration履歴を保証せず、スキーマ変更時に
初期migrationを作り直すことがあります。その場合はローカルDBをリセットしてください。

```bash
rm -rf apps/client/.wrangler/state apps/server/.wrangler/state apps/agent/.wrangler/state
pnpm db:migrate:local
```

リモートD1を使っている場合は`wrangler d1 delete` / `wrangler d1 create`で作り直し、
`apps/server/wrangler.jsonc`の`database_id`を更新してから`pnpm db:migrate:remote`を実行します。

### 4. 起動

```bash
pnpm dev
```

`pnpm dev`は未適用のローカルD1 migrationを先に適用してから開発サーバーを起動します。

管理画面とAPIは `http://localhost:5173`、Agent Viteは `http://localhost:3583` で起動します。
ブラウザはAgentへ直接アクセスせず、常にClient → Server → Agentを通ります。

開発環境では登録時のメール確認を省略し、アカウント作成後にそのままログインします。本番環境ではメール確認が必須です。

管理画面とAPIをTanStack StartのVite開発サーバーで起動する場合:

```bash
pnpm dev:client
```

### 品質チェック

OxlintはTypeScript 7を利用したtype-aware lint、OxfmtはimportとTailwind CSS v4クラスの整列を有効にしています。

```bash
pnpm format        # コードを整形
pnpm format:check  # 整形差分を検査
pnpm lint          # Oxlintを実行
pnpm lint:fix      # 安全に自動修正できるlintを反映
pnpm check         # format・lint・型・テスト・ビルドを一括検証
```

## Cloudflareへのデプロイ

### Wrangler設定

`apps/client/wrangler.jsonc`は公開Worker `openengage` と、内部Worker
`openengage-server`を呼び出す`SERVER` Service Bindingを定義します。

`apps/server/wrangler.jsonc`には以下のBindingsが定義されています。

- `AGENT_APP`: 非公開の`openengage-agent`を呼び出すFetch Service Binding
- `DB`: D1
- `ASSETS_BUCKET`: R2
- `JOBS_QUEUE`: Automation Job、Contact Import/Export (`openengage-jobs`)
- `DELIVERY_QUEUE`: Email、Webhook delivery
- `EMAIL`: Transactional送信用のEmail Sending binding。`allowed_sender_addresses`で送信元を限定
- `openengage-email-events`: Email Sendingの6種類の配送イベントを受け取るQueue consumer

`apps/agent/wrangler.jsonc`は`workers_dev: false`の非公開Worker `openengage-agent`を定義します。
`AI` bindingはFlueの会社情報AgentとAI Gateway Web Search、`BROWSER` bindingは
JavaScript依存の公式サイトを読むCloudflare Playwrightに使用します。
Flueは`/api/agents/hello`にmountされます。Better AuthのCookieやAPIキーをAgentへ渡さず、
Serverがセッション、Workspace membership、会話所有権を検証してから`AGENT_APP`経由で転送します。
Server→Agentの一方向のみで、AgentからServerへ呼び返すbindingはありません。

会社情報エンリッチメントは初期状態で無効です。Cloudflare AI GatewayのUnified Billing creditsを
設定したうえで、`apps/server/wrangler.jsonc`の`COMPANY_ENRICHMENT_ENABLED`を`"true"`へ変更して
ServerとAgentを再デプロイしてください。通常HTMLを先に取得し、Browser RunはJavaScript描画が
必要なページだけに使用します。提案は自動保存されず、会社名とドメインだけを確認後に反映できます。

ローカル開発ではClient ViteがServerをauxiliary Workerとして起動し、Agent Viteを別プロセスで
起動します。`openengage-server`と`openengage-agent`は`workers_dev: false`のため公開URLを持ちません。

初期状態のD1 `database_id` はプレースホルダーです。実際のD1 IDへ置き換えてください。

### Secret登録

Turnstileを使う場合は、`apps/server/wrangler.jsonc`の`vars.TURNSTILE_SITE_KEY`へ公開サイトキーを設定します。`create-openengage`を使う初回セットアップではサイトキーとシークレットが順にpromptされ、サイトキーはWorker設定へ、シークレットはSecretへ登録されます。

```bash
cd apps/server
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put CREDENTIAL_ENCRYPTION_KEY
pnpm wrangler secret put TRACKING_SIGNING_SECRET
pnpm wrangler secret put TURNSTILE_SECRET
```

送信ドメインを有効化します。

```bash
pnpm --filter @openengage/server exec wrangler email sending enable mail.example.com
```

`openengage-email-events` QueueをCloudflare Dashboardで開き、SubscriptionsからEmail Sendingを選択します。送信ドメインを指定し、`message.delivered`、`message.deferred`、`message.bounced`、`message.failed`、`message.rejected`、`message.complained`を購読してください。現在のリポジトリが固定するWranglerではEmail Sending sourceを作成できないため、購読作成のみDashboard操作です。`create-openengage doctor`はdomain、binding、Queue、6イベントの設定を検査します。

### Migrationとデプロイ

```bash
pnpm db:migrate:remote
pnpm deploy
```

通常の`pnpm deploy`は`openengage-server` → `openengage-agent` → `openengage`の順でデプロイします。
Server → Agentは`AGENT_APP`の一方向Bindingのみで、AgentからServerへの逆Bindingは存在しないため、
初回デプロイでも特別な順序は不要です。`create-openengage`は`pnpm --filter @openengage/agent deploy:bootstrap`
を先に実行してから`pnpm deploy`する2段階の初回セットアップを行いますが、これは現在の構成では
`pnpm deploy`単体と等価です(bootstrap環境固有のBinding差分がないため)。

## 初回セットアップ

1. 管理画面でアカウントを登録する
2. 確認メールからメールアドレスを検証する
3. OrganizationとしてWorkspaceを作成する
4. 必要に応じて購読Topicを作成する
5. Cloudflare Email Sendingのdomain、`EMAIL` binding、イベント購読を構成する
6. ContactまたはCSVを取り込む
7. OpenEngageでTransactionalテンプレートを作成・preview・公開する
8. オートメーションを作成・検証・公開する

Better AuthのOrganizationをOpenEngageのWorkspaceとして扱います。

| Role     | 主な権限                           |
| -------- | ---------------------------------- |
| Owner    | Workspace全体、メンバー、設定      |
| Admin    | 設定、APIキー、Webhook、運用       |
| Marketer | Contact、Content、Automation、配信 |
| Analyst  | 閲覧、分析、Export                 |
| Viewer   | 閲覧                               |

## オートメーション

オートメーションは次のNodeから構成されます。

- `Source`: Segment参加、Form送信、Contact作成、API/Webhookイベント
- `Action`: Email、Webhook、Tag、Segment、Score、Field更新
- `Condition`: Contact属性、Tag、Scoreなどの条件分岐
- `Decision`: Open、Click、Reply、Page view、Form submission
- `Delay`: 相対時間、絶対日時、曜日・時間帯

公開時に以下を検証します。

- Sourceが一つだけ存在する
- Node IDとEdge IDが重複していない
- Edgeの接続先が存在する
- Node種別に対してBranchが正しい
- 循環がない
- Sourceから到達不能なNodeがない

公開バージョンは不変です。公開後は同じグラフから新しいdraftが作られ、進行中Contactは参加時のバージョンを完走します。

## Deals CRM

Dealsはワークスペースごとのパイプラインで商談を管理します。初回利用時に標準ステージを作成し、カンバン上で商談を移動できます。

- 商談金額、完了予定日、担当者、連絡先、会社の関連付け
- 進行中・獲得・失注のライフサイクル
- タスク、電話、メール、ミーティングの期限・担当者・完了管理
- 商談とタスクの変更はWorkspaceとRBACで制限

## Reporting

Reportingは最大366日の期間を指定し、D1に保存された実データをリアルタイムに集計します。

- 連絡先: 総数、アクティブ数、追加・アーカイブ推移、上位リスト・タグ
- オートメーション: 参加・完了、進行中、メール配送
- メール: 受付・到達・遅延・失敗・拒否・バウンス・苦情抑止
- 商談: 作成・獲得・失注、担当者別成績、通貨別フォーキャスト、タスク
- サイト: PV、ユニーク訪問者、特定済み率、フォーム、サイトメッセージ

各詳細レポートはCSVでエクスポートできます。集計APIは`Analyst`以上の権限を必要とし、常にWorkspaceでスコープされます。

## Asset管理

画像、eBook、スライドなどのダウンロードコンテンツをR2で一元管理します。管理画面は`/website/assets`です。

アップロードは2経路あります。

```text
POST /api/assets/upload?name=&visibility=&width=&height=   ストリーミング(〜100MB)
PUT  /api/assets/:id/content?name=&width=&height=          差し替え(IDは維持)
POST /api/v1/assets                                        バッファ(〜25MB、oRPC/SDK)
```

ストリーミング経路はリクエストボディをそのまま`R2Bucket.put()`へ流すため、100MBのスライドでも
Workerのメモリ(128MB)を消費しません。ただしWebCryptoにストリーミングSHA-256がないため、
この経路の`checksum`はR2側のMD5です(`checksum_algorithm`列で区別)。checksumはキャッシュバスターと
重複検出のためのフィンガープリントであり、完全性の証明ではありません。上限100MBはCloudflareの
受信ボディ制限(Free/Pro)であって、OpenEngage側の設定値ではありません。

配信は3経路です。

```text
GET|HEAD /a/:workspaceSlug/:id/:filename   公開(認証不要)
GET|HEAD /api/assets/:id/raw               管理プレビュー(Session or Bearer)
GET      /api/v1/assets/:id/file           SDK用ダウンロード
```

公開URLには`?v=<checksumの先頭12文字>`が付きます。一致したときだけ
`Cache-Control: public, max-age=31536000, immutable`を返し、それ以外は`max-age=300`です。
差し替えるとchecksumが変わってURLも変わるため、埋め込み済みの画像は自動的に新しいファイルへ
切り替わります。`:filename`はルックアップに使わないので、リネームしても既存URLは生きたままです。

### 共有バケットとセキュリティ

`ASSETS_BUCKET`はAssetだけでなく、連絡先CSVエクスポート、受信メール添付、イベントアーカイブも
格納します。したがってバケット自体を公開してはいけません。公開配信は必ずD1の行を先に引き、
`visibility='public'`かつ未アーカイブであることを確認してからR2を読みます。さらに`r2_key`が
`{workspaceId}/assets/`で始まることをassertし、行が壊れた場合もPII漏洩ではなく404に落とします。
ワークスペース不明、Asset不明、非公開、アーカイブ済み、オブジェクト欠落はすべて同一の404を返し、
存在を漏らしません。

配信は管理画面と同一オリジンになるため、`text/html`や`image/svg+xml`など
ブラウザがスクリプトとして実行しうるContent-Typeはアップロード時に拒否し、
全Assetレスポンスに`Content-Security-Policy: default-src 'none'; ...; sandbox`を付与します。

## CSV Import / Export

CSV ImportはWorkerで検証後、R2へNDJSONパートとして保存し、Queueで分割処理します。

最低限、次のどちらかの列が必要です。

```text
email
external_id
```

認識する標準列:

```text
email,external_id,first_name,last_name,phone,stage
```

その他の列はCustom Fieldとして保存されます。ExportはCSV数式インジェクションを避けるため、`=`, `+`, `-`, `@`から始まる値をエスケープします。

## API

APIはoRPC contract(`packages/orpc`)を単一の正本として、同じprocedureを2つの入口で提供します。

- `/api/rpc`: 管理画面用のRPCエンドポイント(TanStack Queryとの統合に使用)
- `/api/v1`: SDK・外部連携用のREST(OpenAPI)エンドポイント。contractの`.route()`メタデータから提供

JSON APIの面に手書きのRESTハンドラは存在しません。エンドポイントの追加はcontractへのprocedure追加だけで、
両方の入口とOpenAPIドキュメント、SDKの型に同時に反映されます。

唯一の例外はバイト転送を伴うAssetのルート(下記「Asset管理」)です。`z.file()`はファイル全体を
Workerのメモリへ展開し、シリアライザがレスポンスを占有するため、無バッファのアップロードや
`Range`/`ETag`/`Content-Disposition`をcontractでは表現できません。これらのハンドラも
レスポンス本文はcontractの`Asset` DTOで型付けしてあり、契約から乖離しません。

レスポンスはcamelCaseのDTOをそのまま返します(`{data: ...}`エンベロープはありません)。
エラーは`{defined, code, status, message, data}`のJSONで、contractに宣言されたコードを返します。

OpenAPI:

```text
GET /api/openapi.json
```

主なEndpoint:

```text
GET    /api/v1/contacts
POST   /api/v1/contacts
GET    /api/v1/contacts/:id/timeline
POST   /api/v1/contacts/:id/archive
POST   /api/v1/contacts/:id/restore
POST   /api/v1/contacts/imports
POST   /api/v1/contacts/exports

GET    /api/v1/segments
GET    /api/v1/segments/options
GET    /api/v1/segments/:id
POST   /api/v1/segments
PATCH  /api/v1/segments/:id
POST   /api/v1/segments/validate
POST   /api/v1/segments/preview
POST   /api/v1/segments/generate
POST   /api/v1/segments/:id/refresh

GET    /api/v1/automations
POST   /api/v1/automations
POST   /api/v1/automations/generate
POST   /api/v1/automations/sequences/generate
POST   /api/v1/automations/sequences/apply
PUT    /api/v1/automations/:id/draft
POST   /api/v1/automations/:id/publish
POST   /api/v1/automations/:id/enroll

GET    /api/v1/deals
POST   /api/v1/deals
PATCH  /api/v1/deals/:id
POST   /api/v1/deals/:id/move
POST   /api/v1/deals/:id/tasks
PATCH  /api/v1/deals/:dealId/tasks/:taskId

GET    /api/v1/reports/:category

GET    /api/v1/emails/templates
POST   /api/v1/emails/templates
POST   /api/v1/emails/templates/:id/publish
POST   /api/v1/emails/templates/:id/archive
GET    /api/v1/website/forms
POST   /api/v1/website/forms
GET    /api/v1/website/pages
POST   /api/v1/website/pages

POST   /api/v1/workspace/api-keys
GET    /api/v1/workspace/webhooks
GET    /api/v1/platform/dead-letters

GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/:id
GET    /api/v1/assets/:id/file
PATCH  /api/v1/assets/:id
DELETE /api/v1/assets/:id
POST   /api/v1/assets/:id/archive
POST   /api/v1/assets/:id/restore
```

> **破壊的変更 (v0.1)**: Assetのダウンロードは `GET /api/v1/assets/:id` から
> `GET /api/v1/assets/:id/file` へ移動しました。メタデータを返す `assets.get` が
> 同じパスを必要とし、同一method+pathの2 procedureはOpenAPIハンドラが先勝ちで
> 解決してしまうためです。管理画面は`/api/rpc`(procedure名で解決)を使うため影響はありません。

> **破壊的変更 (v0.1)**: 確認のみを返すmutation(archive・restore・delete・assign・
> remove・refresh・replay・publish・saveなど)の出力は、procedureごとに異なっていた
> `{ archived: true }` / `{ removed: true }` / `{ updated: true }` 等の形を廃止し、
> 共通の `{ ok: true }` に統一しました。件数や新規IDなど意味のある値を返す
> procedure(例: `contacts.bulkUpdate` の `{ updated: number }`)は対象外です。
> あわせて、いくつかの404エラーコードをドメイン別に統一しました
> (`NOT_FOUND` → `FORM_NOT_FOUND` / `PAGE_NOT_FOUND` / `SITE_MESSAGE_NOT_FOUND` /
> `TEMPLATE_NOT_FOUND` / `MESSAGE_VARIABLE_NOT_FOUND`)。SDKの型を再生成すれば
> コンパイル時に検出できます。

APIではbodyやqueryの`workspace_id`を信用しません。Cookie SessionまたはBearer API KeyからWorkspaceを決定し、D1クエリにも必ず`workspace_id`を含めます。

## TypeScript SDK

SDKはoRPC contractから型付けされ、`/api/v1`(OpenAPI)経由で呼び出します。
サーバーと型がずれることはありません。

```ts
import { createOpenEngageClient } from "openengage";

const openengage = createOpenEngageClient({
  baseUrl: "https://ma.example.com",
  apiKey: process.env.OPENENGAGE_API_KEY!,
});

const contacts = await openengage.contacts.list({
  query: "example.com",
  limit: 25,
});

await openengage.contacts.create({
  email: "person@example.com",
  firstName: "Kaen",
  customFields: {
    plan: "pro",
  },
});

// contractに宣言されたエラーは型付きで判別できます
import { isDefinedError } from "openengage";
```

APIキーはWorkspace限定で、D1にはSHA-256ハッシュだけを保存します。平文キーは作成時に一度だけ表示されます。

## Remote MCP

公開URLの`/api/mcp`でstateless Streamable HTTP endpointを提供します。接続にはWorkspace
APIキーをBearer tokenとして指定します。

```text
URL: https://ma.example.com/api/mcp
Authorization: Bearer openengage_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxx
```

提供する主なTool:

- Contact検索
- Dashboard集計
- オートメーション一覧とdraft取得
- オートメーション enrollmentの準備
- 明示確認後のオートメーション enrollment

実配信につながるオートメーション enrollmentは二段階です。準備ToolがD1へ5分間有効な
一回限りの確認Tokenを保存し、確認Toolで`CONFIRM SEND`を明示しない限り実行されません。

## セットアップCLI

ローカルでCLIをビルド:

```bash
pnpm --filter create-openengage build
```

主なコマンド:

```bash
node packages/create-openengage/dist/index.js
node packages/create-openengage/dist/index.js doctor
node packages/create-openengage/dist/index.js backup
node packages/create-openengage/dist/index.js update
node packages/create-openengage/dist/index.js domain add
```

`create-openengage`は送信domainとTransactionalのfrom address/nameを質問し、Email Sendingの有効化、D1、R2、Queues、Secrets、Migration、Agent bootstrap、Server → Agent → Clientの3 Worker deployment、相互Service BindingとEmail bindingの名前置換を順番に構成します。Email Sending event subscriptionだけはDashboard手順を表示します。

開発中のローカルテンプレートを使う場合:

```bash
OPENENGAGE_TEMPLATE_DIR=/path/to/openengage node packages/create-openengage/dist/index.js
```

GitHub・npm公開後は`npx create-openengage`として利用する予定です。`OPENENGAGE_TEMPLATE_REPOSITORY`でclone元も変更できます。

## Email Routing

オートメーションのTransactionalメールは、署名付きのReply-Toアドレスを生成します。

```text
r+<signed-token>@reply.example.com
```

Email Routing handlerは次を確認します。

- TokenのHMAC署名と有効期限
- Workspace、Delivery、Contactの一致
- 受信メールが5MB以下
- Reply先Deliveryが存在する

本文はD1、添付ファイルはR2へ保存し、`replied` Delivery EventとContact Eventを生成します。

## 同意と配信停止

- Topic別購読
- グローバル配信停止
- Bounce、Complaint、手動抑止
- 24時間単位の頻度上限
- ワンクリック解除
- Preference Center
- 送信直前の再判定

TransactionalメールもBounce、Complaintなどの抑止対象です。Marketing用のグローバル停止、Topic状態、頻度上限モデルは将来用に保持しますが、現在は送信自体を停止しています。

## 開封・クリック計測

Cloudflare Email Sendingは`opened`と`clicked`を通知しないため、OpenEngageが自前で計測します。
Workspace設定で個別にON/OFFでき、**既定はどちらもOFF**です。

対象は**Automationメールだけ**です。認証・招待・パスワード再設定などBetter Authが送るメールは
別経路でレンダリングするため、計測対象になりません。

| 設定         | 動作                                             | エンドポイント               |
| ------------ | ------------------------------------------------ | ---------------------------- |
| 開封計測     | `</body>`直前に1×1透明GIFを埋め込む              | `GET /t/:token`              |
| クリック計測 | 本文中の`http(s)`リンクを署名付きURLへ書き換える | `GET /c/:token` → 元URLへ302 |

トークンはHMAC署名済みで、Workspace、Delivery、Contact、有効期限（180日）を含みます。
クリックトークンは遷移先URLも保持し、リダイレクト前に`http(s)`であることを再検証します。

計測すると、次の3つが同時に動きます。

- レポートの開封率・クリック率・CTOR
- Automationのdecisionノード（開封待ち・クリック待ち）の`yes`分岐
- `email_opened` / `email_clicked` のContact Event（Segment条件にも使えます）

### 書き換えないもの

配信停止（`/u/`）、Preference Center（`/preference/`）、公開Asset（`/a/`、`/api/email-images/`）への
リンクは書き換えません。配信停止の可否を計測基盤に依存させないためです。
`mailto:`、`tel:`、アンカー、相対URLも対象外です。
プレーンテキスト版は本文の可読性を優先して書き換えないため、その経路のクリックは記録されません。

### 重複と過大計上

同一Deliveryの開封は初回のみ、クリックは遷移先URLごとに1回だけ記録します
（`delivery_events`の`(workspace_id, provider, provider_event_id)`一意制約を利用）。
それでもApple Mailのプライバシー保護による先読みや、企業のリンク検査による自動アクセスは
排除できません。絶対値ではなく相対比較の指標として扱ってください。

## スコアリングとグレード

Pardotと同じ2軸で連絡先を評価します。行動を測る**スコア**と、属性の合致度を測る**グレード**です。

### スコアリングルール

`page_viewed`、`form_submitted`、`email_opened`、`email_clicked`、`email_replied`、
`custom_redirect_clicked`、`custom_event`のいずれかを条件に、点数の加減算とタグ付与を行います。
一致条件は`any`（すべて）、`resource`（対象IDが一致）、`url_exact` / `url_contains` / `url_starts_with`から選びます。

**`page_viewed`＋URL条件のルールがPage Actionです。** 専用の仕組みを別に持たず、同じルールエンジンで扱います。

ルールにカテゴリを指定すると、全体スコアに加えて`contact_category_scores`のカテゴリ別スコアも動きます。
製品別・関心別にスコアを分けたい場合に使います。

### グレード

グレード条件は連絡先の属性（標準カラムまたはカスタムフィールド）に対する判定で、
合致するたびにグレードを`steps`（3分の1文字単位）だけ動かします。
新規の連絡先は基準の`D`から始まり、`F`〜`A+`の13段階に丸められます。

セグメント条件では`grade_points`で絞り込めます。`grade_points >= 3`は「C以上」です。

グレードはスコア対象イベントの発生時に再計算されます。条件を後から変更しても、
既存の連絡先は次のイベントまで古い値のままです。

## 計測用リンク

`GET /r/:workspaceSlug/:slug`は遷移先へ302で転送し、クリックを記録します。
広告、SNS、PDFなど、OpenEngageの外に置くリンクの効果測定に使います。

サイトトラッキング済みのページから遷移した場合、埋め込みスクリプトが`?oe_v=`に訪問者IDを付与するため、
連絡先が特定できればタイムライン・セグメント・スコア・アトリビューションに反映されます。
IDが無い場合はクリック数だけが増えます。

## キャンペーンとアトリビューション

Projectがキャンペーンです。Projectにメール・フォーム・セグメント・計測用リンクを紐付けると、
それらへの反応が`campaign_touches`に接点として記録されます。

受注した商談に対して、3つの見方で金額を配分します。

| 指標     | 意味                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 関与金額 | 受注前に接触したすべてのキャンペーンに同額を計上（合計は売上を超えます） |
| 初回接点 | 最初に接触したキャンペーンに全額                                         |
| 最終接点 | 受注直前に接触したキャンペーンに全額                                     |

3つを足し合わせないでください。関与は意図的に重複計上し、初回・最終はそれぞれ売上を1回だけ配分します。

## セキュリティ

- 全業務テーブルと主要Indexに`workspace_id`
- Session/API KeyからWorkspace Contextを決定
- Secure、HttpOnly、SameSite Cookie
- Cookieを使う変更系APIでOriginを検証
- Segment ASTを許可済み演算子からparameterized SQLへ変換
- オートメーション公開時のグラフ検証
- Outbound Webhook credentialをAES-GCMで暗号化
- WebhookをHMAC、timestamp、event IDで検証
- Tracking、解除、Reply TokenをHMAC署名
- Webhook送信先のHTTPS強制とprivate/link-local IP拒否
- Email HTMLの変数escapeと許可タグ制限
- FormのTurnstile、honeypot、Origin制限、Idempotency Key
- Assetの実行可能Content-Type拒否、`sandbox` CSP、共有バケットのkey prefix検証
- Queue consumerの条件付き状態更新とDelivery冪等キー

脆弱性を発見した場合は、公開Issueへ機密情報を書き込まず、RepositoryのSecurity Advisoryから報告してください。

## テスト

全体:

```bash
pnpm check
```

個別:

```bash
pnpm typecheck
pnpm test
pnpm build
```

WorkerテストはCloudflare Workers Vitest integration上で実行し、実際のD1 migrationを空DBへ適用します。

現在のテスト対象には以下が含まれます。

- Segment ASTのSQL parameter binding
- オートメーションの循環、到達性、Provider制約
- 同意判定
- Job状態遷移とRetry
- Email rendererのescape
- Cloudflare Email adapterのエラー分類と5 MiBガード
- Email Sendingの6イベント、冪等化、未知message、Bounce・Complaint抑止
- Transactionalテンプレートのdraft、preview、publish、snapshot固定
- Marketing APIと直接Queue投入の停止
- Webhook URLのSSRF対策
- WorkspaceをまたぐContact直接参照の拒否
- Dealのステージ移動、獲得・失注、タスク状態遷移
- Idempotency Keyの重複予約
- Worker healthとD1 migration

## 現在の制約

- `wrangler.jsonc`のD1 ID、送信元ドメイン、Reply domainは環境ごとの設定が必要です。
- Email Sending event subscriptionの作成はCloudflare Dashboardで行う必要があります。
- `opened`と`clicked`はCloudflareからは通知されず、OpenEngage自身のピクセルとリンク書き換えで計測します。プレーンテキスト版のリンクは書き換えないため、その経路のクリックは記録されません。
- 大規模なCSVやSegmentは、実データ分布を使った負荷試験が必要です。
- D1は唯一の業務DBですが、古い詳細イベントと大容量ファイルはR2へ退避します。
- 計測用リンクの匿名クリックは、訪問者IDが無いと連絡先に紐付きません。
- Page Actionはサイトトラッキングが有効なページでのみ発火します。
- グレードはイベント駆動で再計算するため、条件変更の一括反映ジョブはありません。
- アトリビューションはProjectに紐付けたリソースへの反応だけを接点として扱います。
- SMS、LINE、Push、Mautic API/PHPプラグイン互換、SAML/SCIMは対象外です。
- Cloudflare上の実リソースを必要とするProvider smoke testはCIだけでは完結しません。

## 開発ロードマップ

- 管理画面のLanding Page、Project UIの拡充
- Marketing Campaign再開時のprovider、同意、計測設計
- Segment差分評価と大規模データ向けQuery最適化
- R2アーカイブの復元・検索Tool
- Provider contract testと負荷試験Fixture
- `create-openengage`のnpm公開
- デモWorkspaceとオートメーションTemplate

## コントリビューション

IssueやPull Requestを歓迎します。

変更前に次を実行してください。

```bash
pnpm check
```

## ライセンス

[MIT License](./LICENSE)
