# 施策参加者と成果

`/projects` が施策の一覧、`/projects/:id` が参加者・成果・定義・ブリーフ・変数・複製の入口です。旧 `/automations/briefs` URL は新しい画面へ転送します。ブリーフがない Project でも参加者を管理できます。

## 定義と承認

定義は資料請求・問い合わせ・イベントのテンプレートから始められます。初期ステータス、各ステータスの成果扱い、次に進めるステータスを設定し、保存した変更を確認して公開します。循環する遷移や存在しないステータスは拒否します。

公開版は不変です。参加者は登録時の公開版を保持し、その版のステータスと成果の意味で進捗・集計します。定義の変更は新規参加者に新しい版を適用します。既存参加者の意味は変更しません。

ブリーフを持つ施策では、担当者または管理者が下書き状態で定義を編集します。承認済みブリーフは「再編集」で下書きへ戻し、編集・再承認後に定義を公開してください。その間、以前の公開版で参加者管理を続けられます。日々の参加者登録・進捗・訂正にブリーフの再承認は不要です。既存の承認済みリソースリンク権限は維持します。

## 登録・進捗・訂正

Project と Contact の組み合わせは一意です。登録元は手動・API・CSV・フォーム・Automationです。通常の更新は定義に沿って前進し、ステータスを飛ばす場合も到達可能な先に限ります。巻戻しや別の分岐への変更には、手動操作と訂正理由が必要です。履歴を削除せず、訂正後の成果集計にも反映します。

CSV は `contactId` または `email` を含むヘッダーが必須で、任意の `statusId` を指定できます。両方の識別子がある場合は同じ Workspace の同じ Contact を示す必要があります。不明な Contact、無効なステータス、不正な行は行ごとのエラーを返し、他の行を処理します。CSVからContactを新規作成しません。引用符・引用符内の改行を扱い、一回最大1000行です。同じ入力の再試行は同じ冪等キーを使います。受付API `projects.memberImport` は永続化した `jobId`、`status`、`total`、`processed`、行別の `rows` を返します。`projects.memberImportGet({ id, jobId })` で進捗と行別エラーを取得します。同じ Project・要求キー・CSV は同じジョブを返し、同じキーでCSVを変更すると409です。SDKも同名APIを公開し、MCPでは `import_project_members` と `get_project_member_import` を使用します。

同じ操作キーの再試行では登録、進捗履歴、イベントを重複させません。フォームを再送しても、既に進んだ参加者をフォームの初期状態に巻き戻しません。

## フォームと獲得元

フォームには Project、公開定義の版、登録先ステータスを明示的に紐付けます。Project のリソースリンクや過去の接点から参加先を推測しません。署名されたページの計測コンテキストを使う場合は、紐付け先 Project との一致を検証します。公開済みページは公開時に固定したフォーム設定を使用します。

施策フォーム経由で新しく作成した Contact のみ `acquisitionProjectId` を記録します。既存の Contact には追加・上書きしません。Contact、参加者、履歴、イベントの永続化は同じD1トランザクションで完了します。

現在の参加ステータスからフォームの指定先へ進めない分岐競合は、HTTP 422 `invalid_payload` を返します。送信・Contact更新・訪問者・参加履歴は途中保存しません。紐付けや参加者の状態を訂正した後、同じ送信キーで再試行できます。

紐付け先をアーカイブした場合は、施策の担当者または管理者がAPIで関連付けを解除するか、承認条件を満たす有効な施策へ付け替えられます。アーカイブ済み施策を新しい登録先にはできません。公開済みフォームの設定へ反映するには、関連付け変更後にフォームを再公開します。

複製ではフォームの紐付け意図を保持し、Projectを複製先に置き換え、`definitionVersion` を null にします。複製先のブリーフを承認し、プログラムを公開した後でフォームを公開すると、複製先の公開版とステータスを検証して確定します。公開前の複製フォームは利用できません。

## セグメント・イベント・成果

`project_member` グループで `project_id`、`project_status`、`project_success`（0/1）、`project_joined_at`、`project_success_at` を組み合わせます。グループ内の条件は同じ参加者行に適用します。別々のProjectの参加状態と成果が誤って一致することはありません。

参加・進捗・初回成果のイベント名は `project_member_joined`、`project_member_progressed`、`project_member_succeeded` です。`resourceType=project`、`resourceId=projectId` とし、参加者・定義版・ステータス・履歴の識別子を含めます。永続outboxと既存のprojectionを通してSegment再評価とAutomationへ渡します。

成果の母数は指定した参加期間 `[from,to)` に参加し、`asOf` までに登録された人数です。各参加者の `asOf` 以前の最後の履歴から成果人数、成果率、初回成果までの平均秒数を計算します。成果を取り消す訂正後の集計には取り消しが反映され、訂正前の集計時点では元の成果が残ります。売上配分やROIとは別の指標です。

## 統合点

- 型・検証: `@openengage/core/projects` の `ProjectProgramDefinition`、`ProjectMember`、`ProjectMemberTransition`、`ProgramMemberMutation`。
- Server: `projects/program-service.ts` の `mutateProjectMember(database, {workspaceId}, command)`。Automationは実行中のjob/lease/enrollment authorityを渡します。
- DB: `ProjectMemberRepository.prepareMutation` はフォーム書き込みとの原子的なバッチ構築用です。通常の更新は `mutate` を使用します。
- Segment SQL: DBドメインの `compileWorkspaceSegmentFilter` を使用します。
- 実行検証: `apps/server/test/marketo-journey.test.ts` が承認・複製・変数・フォーム・バッチ・営業引継ぎ・成果の通しを検証します。

## 運用上の範囲

- 管理操作は marketer 以上で、ブリーフがある場合の定義編集・公開には担当者または管理者の条件も適用します。閲覧権限のみの利用者は参加者と成果を参照できます。
- 公開版を切り替えても既存参加者を新しい版に移しません。訂正は参加者単位で履歴を残します。
- CSVは専用 `PROGRAM_MEMBER_IMPORT_QUEUE` で25行ずつ入力順に処理します（consumer `max_batch_size=1`）。各行の参加者更新・イベント・結果・進捗は同じDBトランザクションに保存し、完了行を再適用しません。60秒のleaseと所有トークンで古いconsumerを遮断し、停止やQueue送信障害はCronが回復します。公開済み定義は処理単位だけキャッシュし、既存参加者の定義版とrevisionチェックを維持します。
- CSVの行は独立して保存されます。全行の一括ロールバックは行いません。返された行番号とエラーを確認してください。同じ内容の再送は同じ冪等キー、修正した内容は新しいキーで送ります。
- フォームの公開設定と公開済みページの固定版を更新する場合は再公開が必要です。共有フォームの参加先を別Projectへ変更する操作は拒否します。別の参加先には専用フォームを使います。
- コホート成果はContactの営業ステージ、商談売上、広告費に基づくROIを置き換えません。Marketing一斉配信や外部CRM同期はこの機能に含みません。

## 版の違いがある場合

公開し直したフォームのステータスIDが既存参加者の登録版に存在しない場合も、正当なフォーム送信は受け付けます。その参加者の状態・成果・版・履歴は維持します。同じ操作の記録には `unchangedReason=pinned_definition_status_unavailable` を保存し、新規Contactにはフォームが公開時に固定した新しい定義版を適用します。名前からの推測によるステータス移行は行いません。

セグメントの `Project / vN / ステータス名` 選択は、そのProject・定義版・ステータスを同じ参加者行で照合します。保存される条件は `field: "project_status"`、`value: "statusId"` と `program: {projectId, definitionVersion}` です。`program` を省略した条件は全定義版の同じIDを照合し、UIでも「全施策・全定義版」と表示します。版を指定した条件の演算子は `eq`、`neq`、`in` です。

複製時は選択した公開定義に一致する内部参照を複製先の第1版に置き換えます。古い版を指定した条件は、意味が変わるのを防ぐため複製プレビューで拒否します。外部Projectを指定する条件の版は維持します。

## 検証済みの通し操作

実際のmigrationを適用したWorkersテストで、異なる担当者・承認者による承認、明示的フォーム紐付け、Project変数、施策複製、変数変更と再承認、プログラム・フォーム・子Automation・親Automationの公開を実行しています。公開フォームへの新規送信から獲得元・参加者登録、手動進捗、予定枠バッチ、呼出し先の営業引継ぎ、成果への更新、集計時点前後のコホートまで検証します。再実行による重複と複製元の変更も検査しています。

公開フォームのブラウザー用scriptは、`keepNames` を有効にしたminifyあり・なしのバンドルから取り出してDOMで実行します。条件付き入力の表示・必須判定、送信payload、完了表示まで確認する回帰検査をServerのテストコマンドに含めています。

新規環境ではsetup CLIが専用Queue名を生成・作成対象に含めます。既存環境の更新ではmigration `0025_program_member_import_jobs.sql` の適用と専用Queueの用意が必要です。この変更は本番migration適用・Queue作成を自動実行しません。

複製履歴は `projects.cloneList({ id, limit?, cursor? })` で取得します。previewをSQLで除外し、既定20件・最大100件の `{ items, nextCursor }` を返します。次ページには返された `nextCursor` を渡します。`items` は名前・状態・準備件数・エラー・日時だけの軽量要約で、凍結した設定内容は含みません。進捗のポーリングには `projects.cloneProgress({ id, jobId })`、コピー対象・変数・共有参照の確認には `projects.cloneGet({ id, jobId })` を使います。Clientは確認済みのpreview詳細を保持して進捗だけを再取得し、履歴に前へ・次へを表示します。SDKは `ProjectCloneSummary` / `ProjectClonePage` / `ProjectCloneCursor` を公開し、MCPには `get_project_clone_progress` を追加しています。
