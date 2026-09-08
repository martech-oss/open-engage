# LPと外部フォーム

LP画面では、目的・対象者・掲載してよい事実を入力して下書きを生成し、同じ画面で修正を依頼できます。PCとスマートフォンのプレビュー、会話・版履歴、公開、公開済みの版への復元に対応します。管理名の変更は「名前を保存」で確定でき、生成・公開時にも保存します。

生成は既存のFlueサービスとAI設定を使います。新しい `LandingPageDesigner` のルートとDurable Object migrationはAgent Workerに含まれます。ブランド設定はワークスペース共通です。画像は既存のアセットと生成基盤を利用し、有効な下書きに採用した生成画像は一時画像の清掃対象から外します。

生成結果は自由なHTML/CSSと管理対象の参照を持つ文書です。HTMLは許可リストで無害化し、CSSは構文解析して外部読み込みを禁止します。フォーム・CTA・画像・動的表示の参照IDは一意です。AIのJavaScriptは実行しません。プレビューは隔離したiframeで、送信と本番計測を行いません。

公開前に、画像ファイル・フォーム・キャンペーン・Turnstile設定を検証します。Turnstileを使うフォームには既存のサイトキーとシークレットが必要です。公開ページとフォームの版を一括で固定するため、後から共有フォームを編集しても公開ページの入力定義は変わりません。編集・生成は公開中の参照を変更しません。

公開LPは、閲覧計測の同意後に訪問者を識別して閲覧とCTAクリックを記録します。同意がなくてもフォームを送信できます。計測を停止する操作で保存済みの同意と訪問者トークンを消去し、基準ページに戻ります。フォームが別の人のメールアドレスで送信された場合は識別とページの計測コンテキストを更新します。

## 管理API

RESTでは以下を `/api/v1` 以下で利用できます。oRPC契約からSDKとMCPにも同じ操作を公開します。

| 操作                             | API                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| ページ作成・一覧                 | `POST /website/pages`、`GET /website/pages`                                        |
| 下書き保存                       | `PATCH /website/pages/{id}`（`document`と`baseVersionId`）                         |
| 会話・版・ジョブ・プレビュー取得 | `GET /website/pages/{id}/design`                                                   |
| 非同期生成                       | `POST /website/pages/{pageId}/generate`（`prompt`、`baseVersionId`、`requestKey`） |
| 公開・復元                       | `POST /website/pages/{id}/publish`（`versionId`、`baseVersionId`）                 |
| 共通ブランド                     | `GET /workspace/brand`、`PUT /workspace/brand`                                     |
| Form Handler                     | `GET/POST /website/form-handlers`、`PATCH/DELETE /website/form-handlers/{id}`      |

同じ生成要求の再試行には同じ `requestKey` を使います。古い版や変更された要求のキー再利用は競合として扱います。ジョブは画面を閉じても残り、キュー発行失敗や期限切れリースは定期処理が回収します。`failureKind` と `retryable` で再試行と指示・設定の修正を区別します。`landing.generation_failed` などの既存ログで失敗を追跡できます。

## 外部フォーム

フォーム画面の「外部フォーム連携」で入力定義、外部項目のマッピング、許可ドメイン、成功・失敗時のURLを設定します。送信先は `/fh/{workspaceSlug}/{handlerSlug}` です。許可したOriginからJSONまたは `application/x-www-form-urlencoded` をPOSTできます。JSONのCORSプリフライトにも対応します。

送信には8〜191文字の `idempotencyKey` を含めます。同じ送信の再試行は同じキーと内容を使用し、別の送信には新しいキーを使用します。HTMLフォームではhidden項目、JSONではbodyまたは `Idempotency-Key` ヘッダーで指定します。Turnstileを有効にした場合は、検証済みの `cf-turnstile-response` または `turnstileToken` も必要です。

フォーム条件の参照は存在する項目に限定し、循環は保存時に拒否します。非表示の項目は送信データに含まれていても保存しません。段階的な質問は、同意済みの訪問者と現在入力したメールアドレスが一致したときに限り既存回答を使います。メールアドレスの変更や同意撤回では必要な質問を復元します。
