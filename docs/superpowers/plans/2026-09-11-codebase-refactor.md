# OpenEngage 全体リファクタリング実装計画

## Goal

分割済みコードの余分な中継を取り除き、処理の責務と依存方向を揃える。ユーザーが承認した全体リファクタリング案を実装する。

## Global Constraints

- Client・Server・AgentのWorker境界とcore・database・oRPCの責務を維持する。
- 公開API、SDK、DBスキーマ、Queueメッセージ、冪等性キー、D1 batch境界を変更しない。
- 内部Repositoryのexportと関数インターフェースは変更できる。呼び出し側とテストを同時に更新する。
- 行数のためだけの分割や汎用DIコンテナを導入せず、既存の実装パターンと意味のある責務で分ける。
- 各項目を独立して検証・レビューできるコミットとPRにする。Repository撤去はドメイン別に分ける。
- 最後にREADMEの責務規約を更新し、pnpm checkを通す。デプロイやマイグレーション適用は不要。

## Task 1: アーキテクチャ検査の分割

- scripts/check-architecture.mjsをCLI、ファイル・モジュール解決、構文とスコープ解析、値の由来の解析、規約判定に分離する。
- 内部入口runArchitectureCheck({ root })を設け、検査ファイル数と違反一覧を返す。表示と終了コードはCLIが担当する。
- scripts/architecture/配下に責務別の実装を置く。検出能力と既存CLIの呼び出し・出力契約を維持する。
- 既存fixtureを規約別のテストモジュールへ分ける。元のテストコマンドを維持し、必要なテストが全て実行されるようにする。
- APIの再入可能性、同一プロセスで異なるrootを検査しても状態が漏れないことを検証する。
- ファイル移動で既存の規約が外れない構成にする。以降のタスクで移動が発生した場合は規約とfixtureも更新する。
- 検証: pnpm architecture:check、関連format/lint/unused検査。既存の正常・違反fixtureを維持する。

## Task 2: 互換用Repositoryの撤去

- 対象クラス: WebRepository、AutomationRepository、AutomationEngineRepository、ContactResourceRepository、DealRepository、MessagingWorkerRepository、SegmentRepository、ReportsRepository、ProjectBriefRepository、ProjectResourceLinkRepository。
- 各呼び出し側を既存の責務別Repositoryへ移行し、不要なクラスとexportを削除する。
- Fixture、失敗注入、prototype spyも実際の処理を持つRepositoryへ移す。データ変更と取得結果、スコープ、処理順序を維持する。
- 例外変換など単なる委譲以外の処理は利用有無を調べ、必要なら対応する業務処理へ移す。
- ドメインindex.tsに所有するRepositoryと型の公開窓口を集約し、重複した再export経路を取り除く。既存の生DBスキーマ境界を維持する。
- ドメインごとに関連テストと型検査を実施し、ドメイン別コミットを作る。
- 検証: Server/Database型検査とテスト、architecture:check、quality:unused、対象クラスへの実行コード参照が残っていないこと。

## Task 3: Web APIの受付・公開・生成処理を分離

- Web routerをフォーム、ページ、サイトメッセージ、トラッキング、リダイレクト単位のrouterへ分け、元のrouterは登録の集約を担当する。
- フォームとページの複数段階の更新を専用command serviceへ移す。認可とoRPCエラーへの変換はrouterに残す。
- LPの参照検証、公開、AI生成ジョブ・復旧を責務別モジュールへ分ける。
- 入力オブジェクトを直接書き換えず、加工済みデータを渡す。
- エラーコード、slug競合時の再試行、版の競合判定、保存順序、公開版の不変性を維持する。
- Task 2で導入済みの責務別Repositoryを利用する。
- 検証: フォーム・LP公開、slug競合、Turnstile、変数、公開snapshot、参照・画像検証、AI生成復旧の既存テストと不足する振る舞いテスト、Server型検査。

## Task 4: Automation実行制御と外部操作を分離

- workerはジョブ取得、lease確認、ノード実行、待機・完了・失敗の制御を担当する。
- ノード判定と種類別action実行を分離し、既存の型で網羅されたaction registryを維持する。
- 他ドメインのサービスとQueueの配線をruntime側で組み立て、必要な依存を実行処理へ渡す。
- 内部実行関数を依存注入に対応させ、全呼び出し側とテストを更新する。Workerのドメイン処理からruntimeへの逆依存を作らない。
- Queueメッセージ、冪等性キー、D1 batch境界、lease・再試行・子Automationの振る舞いを維持する。
- 検証: Automation action、condition/decision、公開済み定義、子呼び出し、lease喪失、再試行、完了競合、scoring、runtime dispatchのテストとServer型検査。

## Task 5: UIの状態管理と表示の分離

- AutomationAiSheetをcontroller、参照選択、提案プレビュー、差分計算に分ける。既存のEmailAiSheet/EmailSequenceAiSheetの構成を参考にする。
- ProjectClonePanelを一覧、進捗、入力ダイアログ、変数入力、controllerに分ける。
- 非同期処理と状態遷移をcontrollerへ、取得・polling設定をfeature APIへ集約する。
- 既存のAIリクエスト識別による古い生成結果の破棄を維持する。複製固有の型付きカーソルは専用controllerで扱う。
- 表示、保存・公開のユーザー操作、query key、更新後のinvalidation、polling条件と間隔を維持する。
- 検証: AI生成中の対象切替・再表示・適用失敗、複製のページ切替・進捗表示・再試行、既存Clientテストと型検査・ビルド境界。

## Final verification

- READMEの責務規約を実装に合わせて更新する。
- pnpm checkとClient bundle checkerのテストを実行する。
- 全体レビューで各タスクの完了と公開契約・DB schemaに変更がないことを確認する。
- コミット境界に沿ったdraft PRを作成し、検証結果と未解消の制約があれば明示する。
