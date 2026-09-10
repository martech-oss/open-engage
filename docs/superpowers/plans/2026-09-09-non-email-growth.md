# 非メール獲得改善 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 選択された流入分析・匿名CTA・スコア改善を既存のUI/API/実行処理に組み込む。
**Architecture:** 既存のReports、Site Message、Scoringを各々拡張する。DB依存と公開計測の境界を維持し、個別の機能テスト後に全体を検証する。
**Tech Stack:** TypeScript、Zod、oRPC、React、Drizzle、Cloudflare D1/Workers、Vitest。
**Spec:** docs/superpowers/specs/2026-09-09-non-email-growth-design.md

## Global Constraints

- 既存のgap-hubspot作業ブランチを利用し、既存の比較資料を保持する。
- 新たな有料サービスや依存パッケージは不要。
- Migrationファイルは追加するが既存の開発DB・リモートDBへの適用、デプロイはしない。
- 選択された3機能以外の機能追加・無関係なリファクタリングは行わない。

### Task 1: スコアの減衰と上限

**Files:** packages/core/src/scoring/_、packages/database/src/scoring/_、apps/server/src/scoring/_、apps/server/src/runtime/scheduled-tasks.ts、apps/client/src/features/scoring/_、必要なoRPC契約、migration 0026、関連テスト。
**Interfaces:** 既存scoringRuleWriteにnullableなdecayDays/maxScoreを追加（入力省略可）。ScoringEventの加点寄与をsnapshotし、boundedな定期減衰サービスをscheduledへ登録。publicな既存applyScoringForEventの呼び出し元と互換を維持。

- [x] 既存fixtureで上限・減衰・再送・異なるWorkspace・カテゴリ・手動調整・ルール編集後を検証するテストを追加し失敗を実行確認する。
  ```ts
  expect((await readContact(contactId)).score).toBe(25); // 20点の行動を繰り返しても上限25
  expect((await readContact(contactId)).score).toBe(15); // 手動5 + 20点の半減10
  ```
- [x] 型と保存、寄与台帳、原子的差分反映、定期実行と下流再評価、設定UIを実装する。
- [x] `pnpm --filter @openengage/server exec vitest run test/scoring-limits-decay.test.ts test/scoring-events.test.ts test/scoring-rules.test.ts` と影響するcore/clientテストを実行する。
- [x] 変更ファイルをレビューし、実行結果と制約を記録する。

### Task 2: 匿名CTA

**Files:** packages/core/src/web/schema.ts（実際のSite Message定義位置に従う）、packages/database/src/web/schema.ts・site-message-repository.ts・visitor-message-repository.ts、apps/server/src/public/site-message-routes.ts・templates.ts、apps/client/src/features/website/site-message-editor-dialog.tsx、migration 0027、関連テスト。
**Interfaces:** SiteMessageWriteにaudience（identified/all）とfrequency（session/page）、省略時identified/session。GETは対象と同意に従い公開メッセージを返す。既存イベントPOSTは同意・識別検証を保持。

- [x] 未同意・匿名GET、識別専用の除外、URL/Origin/期間の除外、旧入力defaults、ブラウザ表示/再表示/ストレージ拒否のテストを追加し失敗を確認する。
  ```ts
  expect(body.data.map((message) => message.id)).toEqual([publicMessage.id]);
  expect(await visitorCount()).toBe(0); // CTA表示だけでは識別を作らない
  ```
- [x] 型・保存・API・ブラウザ・編集UIを実装する。Migrationの旧レコードdefaultsを維持。
- [x] `pnpm --filter @openengage/server exec vitest run test/anonymous-site-messages.test.ts test/website.test.ts src/public/tracking-browser.test.ts` と関連clientテストを実行する。
- [x] 同意の変更中や重複呼び出し時に表示/識別情報が漏れないことをレビューする。

### Task 3: 流入レポート

**Files:** packages/core/src/reports/schema.ts、packages/core/src/web/新規source分類ヘルパー、packages/database/src/reports/新規acquisition-repository.tsとexports、apps/server/src/reports/新規acquisition-report.tsとrouter、packages/orpc/src/reports/contract.ts、apps/server/src/public/tracking-routes.ts、apps/client/src/features/reports/関連API・navigation・filters・view・CSV、関連テスト。
**Interfaces:** reports.acquisitionは既存reportQuerySchema（日付・通貨）を受け、新規AcquisitionReportを返す。既存レポートの出力は変更しない。source分類をcoreで純粋関数化。

- [x] 分類・内部参照・不明、初回流入、visitorの後続紐付け、期間内成果と期間外接点、複数通貨、Workspace分離をテストし失敗を確認する。
  ```ts
  expect(report.sources.find((row) => row.source === "google")).toMatchObject({
    won: 1,
    wonValue: 50000,
  });
  expect(report.sources.reduce((sum, row) => sum + row.won, 0)).toBe(1);
  ```
- [x] サーバーで外部page_viewedのsourceを正規化し保存する。既存sourceを読むSQL集計とサービス・契約を実装する。
- [x] 流入元タブ、通貨選択、指標・ソース表、CSV、初回流入と保持範囲の説明を追加する。
- [x] 関連core/server/clientテストを実行する。

### Task 4: 統合検証

- [x] 3機能の利用方法、時刻・集計・互換条件、migration適用手順をdocsへ記録。
- [x] `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check`、影響するパッケージのテスト、client/server buildを実行する。
- [x] 最終diffをレビューし、変更したファイルをOxfmt整形。実行結果を記録する。

## レビュー・検証記録（2026-09-09）

対象は `12edffd6e6e70c1b9aa4fd6577f1ce26ada7315b` を起点とする作業ツリーです。

- スコア減衰が休眠判定を更新する問題を修正し、3種の再参加方針で実行検証しました。
- visitorだけを持つフォーム送信も流入に帰属させ、Contact識別前後と二重計上防止を検証しました。
- 未同意で開始後に同意を復元する再訪でも保存済み訪問者情報を利用し、撤回後は旧情報を復元しないことをブラウザ実行テストで確認しました。
- 各機能の仕様・品質レビューと最終統合レビューは修正後に承認済みです。
- Migrationは0026・0027を生成し、メタデータの連続性を確認しました。Workersテスト用の空DBで検証し、既存の開発DB・リモートDBには適用していません。

最終 `pnpm check` は27タスクすべて成功しました。format・lint・未使用コード・型検査・全パッケージのテスト・ビルドを含みます。Serverは133ファイル664テストと公開フォーム実行2件、Clientは85ファイル345テスト、Coreは30ファイル184テスト、Databaseは8ファイル22テストが成功しています。変更のない対象ではTurboの成功キャッシュを使用しています。アーキテクチャは172規約テストと1,181ソースファイルの検査に成功しました。Clientの本番ビルドとバンドル境界、ServerのWrangler dry-runも成功しています。

これはテスト環境・生成スクリプト・DOMテストでの検証です。実サイトへの設置、実際のブラウザでの手動操作、既存DBへの適用、デプロイは実行していません。
