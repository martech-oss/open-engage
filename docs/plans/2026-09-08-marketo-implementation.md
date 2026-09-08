# Marketo差分1〜3 実装記録

ユーザー承認済み計画（2026-09-08）の実装。作業ブランチ: `gap-marketo`。

## 共通要件

- 既存Project、D1、Queues、Cron、公開版、冪等処理を拡張する。各機能はDB/API/管理画面/テストまで完成させる。
- coreの型・検証とoRPC contractが公開インターフェースの正本。REST/SDK/MCP/AI生成の型・候補・検証にも反映する。
- 開発版として型/API/schema変更可。Drizzle migrationを生成するが、既存開発DBをリセット・移行しない。空のテストDBで検証する。
- 一斉Marketingメールと派生機能、SaaS認証、外部CRM、ABM、Custom Objects、高度BIは対象外。
- 定義変更は確認後の再公開。稼働中の公開版・実験・実行は元の版を維持する。

## Task 1: 施策参加者管理

- Projectに施策種別、版管理されたステータス定義、初期・成果ステータスを追加。Contact全体の営業ライフサイクルと分離。
- 初期テンプレート: 資料請求（請求完了が成果）、問い合わせ（商談化が成果）、イベント（出席が成果）。施策ごとに変更可。使用済み定義・過去成果の意味を破壊しない。
- Project×Contact一意のProjectMember: 現在status、参加日時、初回成果日時、登録経路。ProjectMemberTransitionで履歴保存。
- 通常は前進。巻戻し・分岐先変更は理由付き手動訂正。履歴保持し成果集計も訂正。
- 手動/API/CSV/フォーム/Automation登録更新。CSVは既存Contact ID/email照合、不明は行別エラー。
- フォームは明示的Project・更新先status紐付け。共有フォームと計測コンテキストを検証し、リソースリンクから推測しない。
- 獲得元Projectは施策フォーム経由の新規Contact作成時のみ記録。既存Contactや過去接点から推測しない。
- 参加/進捗/初回成果イベント→segment再評価/Automation。フォーム再送やジョブ再試行を冪等に。
- SegmentFilter: Project参加/status/成果/参加・成果日時。同一ProjectMember行で条件を評価。
- `/projects`と`/projects/:id`に一覧/詳細、既存ブリーフ統合、旧URL転送。ブリーフなしでも使用可。参加者一覧/検索/手動登録/CSV/進捗/訂正/履歴/成果。
- 既存承認フローを維持。定義編集と日々の参加者更新を分離し、参加者更新に再承認不要。
- core ProjectProgramDefinition/ProjectMember/ProjectMemberTransition、定義管理/参加者管理/成果API。
- 成果は参加日コホートを母数、集計時点までの成果人数/率/初回成果まで時間。売上配分/ROIと区別。

## Task 2: Automation実行制御

- 開始方式event/batch/callable。既存event維持、Project参加・進捗・成果イベント追加。
- batch: 今すぐ/日時指定/毎日/毎週/毎月。静的listまたはSegmentFilter。事前人数/sample確認。
- Workspace初期timezone。月次存在しない日=月末、DST存在しない時刻=skip、重複=初回。
- AutomationRunと対象者台帳。開始時Contact ID集合確定、Queue分割登録。以後条件変更で組み替えない。archive/reentryは登録直前確認。
- 予定枠一意、Cron/Queue重複・中断を再開。複数回逃した場合最新1回。対象数/登録/skip/失敗/進捗UI。登録完了とフロー完了を区別。
- reentry once/every_time/cooldown。event/API/batch共通、最後の参加開始から、Automation×Contactで版を跨ぐ、同時判定登録を原子的に。
- conditionにSegmentFilter共通UI/検証/SQL（AND/OR、会社商談の同一行、行動期間回数、カテゴリscore、ProjectMember）。ノード時評価をjobに保存しretryで分岐変化しない。
- Project登録進捗action。scoreは全体/category、加減算/set。
- callable呼出しawait/fire-and-forget。delay/eventwait/webhook利用可（Webhookは送信受付が完了）。親publishで子と依存先の公開版固定。子更新は親republishまで非反映。
- childはContact/Project文脈継承、呼出し単位冪等で通常reentryから独立。await失敗親へ伝播、async親継続し失敗履歴。明示cancel子孫へ伝播。
- cycle/crossWorkspaceをpublish時拒否。親子通知重複でも親再開1回。
- AutomationDefinition拡張、preview/run/cancel/detail/親子履歴API/UI、AI型・候補検証も更新。

## Task 3a: 共通変数

- Workspace→Project上書き。Project専用key可。型string/number/boolean/datetime/url。script/再帰参照なし。
- LP表示文/CTA、フォーム表示文/完了メッセージ、Automationの対応する設定値。数値日時URLは型付きVariableRef、resource IDの文字列置換は禁止。
- 各resourceに変数解決Projectを1つ明示（複数linkでも切替なし）、callableは親設定を継承。
- publish時解決検証、値/定義版snapshot保存。未定義/型違い/不正URL拒否。変数編集時uses/diff、republish反映。稼働中Auto/既存LP実験は旧値。
- HTML escapeと既存sanitize。VariableDefinition/VariableRef/resolution、管理/uses/impact API/UI。

## Task 3b: 施策一式複製

- 詳細複製UI: 新name/owner/approver/reviewAt/Project変数。コピー対象/共有参照preview。
- 公開版優先、なければ最新draft。preview内容/版を固定して開始、中途編集を混ぜない。
- Project設定/brief/参加status/vars、リンクLP/forms/Automation/segments/redirects。構造依存forms/実験variants/Project内callableも含む。
- リンクTransactional templateもコピー（既存resourceType `email_sequence`はemailTemplatesを参照）。assets/tags/営業担当/webhook/施策外共通resourceは同Workspaceで共有。
- resourceは一度だけcopy、ID/slugmapで内部参照/計測Project/変数context置換。literalURLは管理対象と確認できるものだけ置換。
- members/static所属/成果接点費用/実行承認履歴はコピーしない。dynamicsegment定義コピーし再評価。
- 全resource draft、Automation/timer停止、実験未開始。通常の承認/publish/activate手順で開始。
- ProjectCloneJob+mapping、再開可能、staging中通常利用から隔離、全参照検証後まとめて公開。要求再送で重複先なし。
- preview/start/status/retry API/UI。failure/recoveryログと運用表示。

## Task 4: 統合・検証・ドキュメント

- 機能ごと意味あるbehaviorテスト先行。既存のアーキテクチャ制約を守る（SQLはDB repositoryのみ、client通信はfeature *-api.ts経由）。
- program: 手動/API/CSV/form、重複、progress/correction、cohort、acquisition、Workspace境界。
- automation: DST/monthend/cron重複、中断再開cancel、snapshot後条件変更/archive、競合reentry/境界/跨版、同一関連行、分岐固定。
- callable: await/async、waitingchild、failure/cancel/cycle/版固定/親二重再開防止。
- variables/clone: override/missing/type/republish/shared/remapping/fault recovery、元resource独立。
- 通し: clone→vars→approve/publish→form→member→scheduledbatch→共通営業引継ぎ→cohort API/管理画面。
- 関連テスト後`pnpm check`。空テストDBへ全migration適用。email/LP/ROI回帰。遅延/batch/call/clone failures運用画面追加。
- 設計/操作/制約/検証結果をdocsへ追記する。

## 実装状況

開始前: 作業ツリーclean。既存serverの関連8ファイル34テスト成功（marketing journey/visitor identity/rich segments/sales handoff/form handlers/LP optimization/personalization/ROI lifecycle）。

進捗と技術判断は `.superpowers/sdd/2026-09-08-marketo-implementation/progress.md` に継続記録し、確定した操作仕様・検証結果を本書へ反映する。
