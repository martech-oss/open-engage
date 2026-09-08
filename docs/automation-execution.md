# Automation の実行制御

Automation はイベント、バッチ、他のフローからの呼び出しで開始できます。定義の編集は下書きに保存し、公開してから実行します。公開済みの実行は、後から下書き・変数・呼び出し先を編集しても元の版を使い続けます。

## 管理画面での操作

1. Automation 一覧で空のフローを作成します。メールテンプレートは不要です。初期タイムゾーンは Workspace の設定です。
2. フロー上部でタイムゾーンと変数解決用 Project を指定します。Project とのリソースリンクから変数の文脈を推測しません。
3. 開始ノードで方式と再参加ルールを設定します。イベント方式には既存イベントに加え、施策への参加・進捗・初回成果があります。
4. 条件、待機、スコア、施策参加者の登録・進捗、営業引継ぎ、子フロー呼び出しを接続し、保存して公開します。条件とバッチ対象は Segment と共通の条件ビルダーを使います。
5. バッチは「実行」タブで対象人数とサンプルを確認して開始します。プレビューした公開版が変わっていたら再確認が必要です。予定実行も同じ実行履歴に表示されます。

日時指定と待機終了日時の入力欄は Workspace のタイムゾーンを表示し、その地域の日時を UTC に変換します。毎日・毎週・毎月の予定と曜日・時間帯の待機には、フローのタイムゾーンを使います。不完全な日時や夏時間で存在しない日時には入力エラーを表示します。

実行画面は、登録作業の完了とフロー全体の完了を分けて表示します。対象人数、未処理、登録、スキップ、登録失敗、フローの実行中・完了・失敗を確認できます。対象者のページにはスキップ理由・失敗内容・登録試行回数を表示します。参加履歴を開くと各ジョブと子フロー、待機期限、失敗内容を確認できます。バッチ以外のイベント/API 参加も一覧から開けます。

実行または参加履歴のキャンセルは、進行中の子孫フローにも伝播します。完了済みのスコア変更・施策更新・外部への送信を取り消す操作ではありません。

## 開始と再参加

| 方式     | 設定と意味                                                                    |
| -------- | ----------------------------------------------------------------------------- |
| イベント | フォーム、Contact、Segment、API/Webhook、休眠、Project 参加・進捗・成果       |
| バッチ   | 静的リストまたは SegmentFilter。今すぐ、日時指定、毎日、毎週、毎月            |
| callable | 親の `call_automation` アクションから、同じ Contact と変数解決 Project で開始 |

`once` は Automation × Contact で一度、`every_time` は異なる開始イベントごと、`cooldown` は最後の参加開始から指定分数が経過した後に再参加できます。公開版を跨いで判定し、判定と参加・最初のジョブの作成を D1 の同じ atomic batch 内で行います。同時に届いたイベント/API/バッチもこの判定を共有します。イベント ID は保持し、ポリシーを変更しても同じイベントの再送を重複登録しません。

子フローは通常の再参加判定から独立しています。同じ親の呼び出しジョブから作る子参加は一つです。

## バッチの対象台帳と予定

プレビューは現在の対象人数と最大20人のサンプル、公開版 ID を返します。対象 Contact ID の集合を固定する時点は実行開始です。`automation_runs` と `automation_run_targets` を同じ D1 batch で作り、以後の条件・スコア・リスト所属変更では台帳を組み替えません。登録直前に Contact のアーカイブ状態と再参加ルールを確認します。

`workspace_id / automation_id / slot` は公開版を跨いで一意です。手動開始の slot は `manual:<requestId>`、予定開始は予定時刻の UTC 文字列です。要求の再送や Cron/Queue の重複で別の実行を作りません。登録完了時刻と全フロー完了時刻は別に保存します。

月次で存在しない日は月末に丸めます。夏時間で存在しない予定時刻はスキップし、重複時刻は最初の一回だけ実行します。複数の予定を逃した場合は、最後に記録した予定枠以降の最新一回だけを作ります。初回の予定走査はその版の公開時刻以降を対象にします。公開前に過ぎた日時指定の枠は遡って作りません。

Cron は対象集合を固定し、登録用 Queue メッセージを送ります。Contact の登録を Cron 内で全件待ちません。予定走査も Automation ID の順に最大100件ずつ処理し、継続ページは最初の走査時刻を保持して Queue へ渡します。手動実行専用のフローが走査枠を消費せず、処理済みや未来の予定が後ろのページを妨げません。

登録 Queue は最大100件の台帳を処理し、未処理が残れば自ら次のメッセージを送ります。途中で停止しても Cron が登録途中・フロー実行中の履歴を回収します。登録例外は対象ごとに記録し、5回まで再試行します。対象の条件を再検索して失敗を隠すことはありません。

## 条件、スコア、施策アクション

条件ノードは実行時に共通 SegmentFilter の SQL で評価し、最初の分岐をジョブの payload に保存します。再試行は保存済みの分岐を使います。AND/OR、会社・商談・イベント・ProjectMember の同一関連行、期間・回数、カテゴリスコアを共通条件として扱います。公開・生成・プレビューでも共有の構造、Workspace リソース、カスタム項目の型・演算子検証を使います。エラーには Automation ノードと条件パスを含めます。

`change_score` は全体またはカテゴリのどちらかを指定し、加減算または set を実行します。カテゴリ指定の操作は全体スコアを変更しません。効果の台帳、差分のスコアイベント、実値の更新を atomic batch で保存し、ジョブ再試行で二重加算しません。

`upsert_project_member` は Project の参加者更新サービスを使います。status 未指定は登録、指定時は通常の進捗規則に従います。公開中の施策ステータスを検証し、実行ジョブの lease とキャンセル状態を同じ更新権限として確認します。手動訂正に必要な巻戻しを Automation から迂回しません。

## 公開版、変数、callable

`automation_versions.graph` は変数参照を含む元定義です。`resolved_graph` は実行用定義、`variable_snapshot` は解決に使った値・定義版です。変数解決用 Project は resource と graph の `variableProjectId` に明示します。公開は読み取った元 graph と現在の graph を比較し、同時編集を検知した場合は公開版・新下書き・トリガー・ポインターを一切変更せず再確認を求めます。

型付き参照を使える設定値は以下です。リソース ID の文字列置換はしません。

| ノード           | 対応フィールド                        |
| ---------------- | ------------------------------------- |
| delay            | `minutes` の number、`at` の datetime |
| decision         | `withinMinutes` の number             |
| change_score     | `amount` の number                    |
| handoff_to_sales | `title` の string                     |
| update_field     | `value` のスカラー参照                |

`dependencies` は配列ではなく、呼び出しノード ID をキーとする JSON object です。依存がなければ `{}` です。それぞれの値は `automationId / versionId / sourceGraph / graph / variableSnapshot / dependencies` を持ちます。親の公開時に子の公開版と推移的依存を固定し、元の参照を親の変数文脈で解決します。子が既に固定している孫以降の版はその版を保持します。子だけを再公開しても親には反映されません。親の再公開が必要です。

公開時に同一 Workspace、callable 開始、公開済み、循環なしを検証します。依存展開は100件・深さ20を上限とします。子の元定義も保持するため、明示的な親の Project 文脈を継承できます。

await は親ジョブを永続的な待機にして子の終了を待ちます。子の失敗・キャンセルは親へ伝播します。async は子を作った後に親を継続し、子の失敗は親子履歴に残します。子には通常の delay、イベント待ち、Webhook アクションを使用できます。Webhook の完了は既存配送経路への送信受付を意味します。

待機を確定したジョブは再試行回数をリセットします。待機の前と再開後を別の試行段階として扱い、5回目の開始で待機に入っても取り残しません。旧処理で `pending / attempts >= 5 / waiting=true` となったジョブも lease recovery で修復します。子の完了通知と worker の重複処理は、親の継続を一度だけ作ります。

## API と runtime の接続

公開契約は `packages/orpc/src/automations/execution-contract.ts`、業務型は `packages/core/src/automations` が正本です。REST のベースは `/api/v1` です。

| API                                                        | 用途                                           |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `POST /automations/{id}/runs/preview`                      | 人数・サンプル・公開版を確認                   |
| `POST /automations/{id}/runs`                              | `requestId / versionId` を指定して開始、202    |
| `GET /automations/{id}/runs`                               | 直近50実行                                     |
| `GET /automations/{id}/runs/{runId}`                       | 対象台帳を100件単位で cursor ページング        |
| `POST /automations/{id}/runs/{runId}/cancel`               | 実行と進行中の子孫をキャンセル                 |
| `GET /automations/{id}/enrollments`                        | 直近100参加                                    |
| `GET /automations/{id}/enrollments/{enrollmentId}`         | ジョブ・子フロー・失敗履歴                     |
| `POST /automations/{id}/enrollments/{enrollmentId}/cancel` | 参加と進行中の子孫をキャンセル                 |
| `GET /automations/execution-options`                       | 利用可能な施策・ステータス・callable・カテゴリ |

Server の `run-service.ts` は `dispatchScheduledAutomationRuns(database, now?, limit?, queue?, afterAutomationId?)` と `processAutomationRun(runId, workspaceId, database, limit?, queue?)` を公開します。`call-service.ts` は `recoverAutomationCalls(database, now?, limit?)` を公開します。

Queue メッセージは `{kind:'automation_run',workspaceId,runId}` と `{kind:'automation_schedule',now,afterAutomationId}` です。後者の `now` は最初の Cron 時刻です。runtime の接続は既存の Queue/Cron dispatcher が行います。queue を省略した予定走査はテスト用にページを順に走査し、登録処理は行いません。

## 運用と制約

Settings の運用状態と Automation 実行画面を確認します。登録失敗、子フロー失敗、予定の遅延には以下のログがあります。

| ログ                                 | 意味                                          |
| ------------------------------------ | --------------------------------------------- |
| `automation.schedule_delayed`        | 確定した予定枠が5分超遅延                     |
| `automation.schedule_failed`         | 個別予定の走査・実行開始失敗。後続予定は継続  |
| `automation.batch_enrollment_failed` | 対象者の登録例外。run/contact ID と台帳に詳細 |
| `automation.callable_await_failed`   | await 子の失敗                                |
| `automation.callable_async_failed`   | 親とは独立して進んだ子の失敗                  |

callable 失敗の通知済み印は既存の action effect 台帳に保存します。汎用 Queue failure と lease recovery の記録も引き続き利用します。

停止済み Automation から新しいバッチは開始できません。公開版の変更は既存 run/enrollment の版を置き換えません。非同期の子は親の完了後も動くため、親の完了数だけで子の成功を判断せず参加履歴を開いてください。登録の終端失敗を再実行する場合は新しい実行要求となり、再参加ポリシーが適用されます。

対象集合の固定は一つの D1 `INSERT ... SELECT` です。登録は Queue 分割ですが、大規模な対象抽出のクエリ負荷・D1 の上限については実データでの負荷試験が必要です。一斉 Marketing メールは対象外であり、既存の送信能力・同意・抑止の規則を変更していません。

## 検証

2026-09-08、migration `0023_marketo_programs_automation_variables_clone.sql` と全先行 migration を空のテスト D1 に適用しました。開発 DB の reset、migration 適用、deployment はしていません。

- Server/MCP 関連15ファイル66テスト成功。対象固定、同時再参加、版を跨ぐ境界、Queue 分割・再開、条件分岐固定、callable 版固定・await/async・失敗・キャンセル、スコア冪等、MCP 実 API の対象数を検証。
- Core の Automation と関連 AI 契約6ファイル31テスト成功。月末、DST gap/fold、最新一回、営業時間外から次の地域時刻の待機枠、型付き参照と依存固定を検証。
- Agent の3ファイル58テスト成功。
- Client の10ファイル44テスト成功。実行進捗と失敗表示、開始方式・再参加・ノード更新、日時入力、共有条件、キャンバスの依存境界を DOM/ユニットテストで検証。
- 独立レビューの4指摘は `apps/server/test/automation-review-regressions.test.ts` で失敗を再現してから修正。公開の同時編集、予定の後続ページ、5回目の待機と再開後の試行、共有フィルターの参照・型検証を含む。

全体の通しシナリオ、隔離された UI の確認、リポジトリ全体の最終検証は[統合検証記録](marketo-implementation.md)を参照してください。

Email sequence の既存経路も追加検証しました。承認済み brief とテンプレート・Automation の atomic 作成、再開した brief の拒否、同一要求の再送を含む関連3ファイル28テストが成功しています。新しい Project 文脈と draft snapshot 列に合わせた作成経路を修正しました。
