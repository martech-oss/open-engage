# OpenEngage 全体リファクタリングの実装結果

## 変更内容

1. アーキテクチャ検査をCLI、ファイル・モジュール解決、構文とスコープ、値の由来、規約判定に分割した。`runArchitectureCheck({ root })`は検査ファイル数と違反一覧を返し、CLIが表示と終了コードを担当する。既存171件のfixtureを維持して規約別テストに整理し、異なるrootを同じプロセスで検査するテストを追加した。
2. 互換用Repository 10個と重複barrel 3個を削除した。呼び出し側・fixture・失敗注入を責務別Repositoryへ移し、ドメインの`index.ts`を公開窓口に揃えた。撤去は8ドメインのコミットとPRに分けた。
3. Web routerをフォーム・ページ・サイトメッセージ・トラッキング・リダイレクトに分割した。フォームとページの複数段階の操作をcommand serviceへ移し、認可とoRPCエラー変換をrouterに残した。LPの参照検証・公開・AI生成と復旧も分離し、入力を変更せずに加工済みデータを渡す。
4. Automationのworkerをジョブとleaseの制御に絞り、ノード判定と型で網羅されたaction実行を分離した。runtimeが責務別Repositoryとメール・営業引き継ぎ・施策参加者・Contact操作を組み立て、必要な操作を渡す。ドメインからruntimeへの逆依存を構造検査で禁止した。
5. Automation AIをcontroller・参照選択・提案プレビュー・差分計算に分割した。施策複製もcontroller・一覧・進捗・ダイアログ・変数入力に分割し、取得とpolling設定をfeature APIへ集約した。既存のコンポーネント入口、AIリクエスト識別、型付きカーソルを維持し、抽出した`.ts` controllerにも既存の行数制限を適用した。

READMEにはrouter・service・Repository・runtime・UI controllerの責務と、構造検査の保守方法を反映した。

## 維持した契約と処理

- Client・Server・Agentの境界、公開API、SDK、DBテーブル定義、マイグレーションを維持した。内部Repositoryのexportと実行関数のインターフェースは更新した。
- Queueメッセージ、冪等性キー、D1 batch境界、lease確認と再試行の意味を維持した。
- 自動slugの再試行と明示slugの競合応答、フォームの公開条件、LPの保存順序・版の競合・公開snapshotの不変性を維持した。
- AIの対象変更・閉じ直しによる古い応答の破棄、適用失敗後の再試行、複製のページング・進捗・再試行を維持した。
- 複製履歴は処理中の行がある間3秒、選択したジョブの進捗は処理中の間2秒でpollingする。query keyと更新後のinvalidation範囲を維持した。

## 検証

`pnpm check`は全27タスクが通過した。各段階で最終ソースを実行して得た有効なTurboキャッシュを利用し、全8ワークスペースの型検査・テスト、lint、format、未使用コード、構造検査、ビルドを確認した。

Vitestは合計**1,385件・275ファイル**が通過した。着手時の1,330件から55件の回帰テストを追加した。

| 対象     | ファイル | テスト |
| -------- | -------: | -----: |
| Server   |      138 |    714 |
| Client   |       88 |    370 |
| Agent    |        3 |     58 |
| Core     |       30 |    184 |
| Database |        9 |     29 |
| oRPC     |        1 |     16 |
| SDK      |        2 |      6 |
| 導入CLI  |        4 |      8 |

- 構造検査: 204件のテスト、1,202ソースファイルの依存関係検査が通過した。
- 公開フォームの実行検証: 2件が通過した。ServerのSQL境界検査も通過した。
- `node --test scripts/check-client-bundles.test.mjs`: 12件が通過した。Client本番ビルドの実バンドル境界も通過した。
- Serverのビルドは`wrangler deploy --dry-run`で確認した。実環境へのデプロイやマイグレーション適用は行っていない。

Webでは実D1のslug競合、凍結した入力、下書き保存から公開までの順序、生成Queueの送信失敗と復旧を検証した。Automationでは注入した依存を使う17件と実際のQueue dispatchを通す2件を追加し、既存のlease喪失・完了競合・永続化済み判定・子呼び出し・スコアの一度限りの反映も確認した。Clientでは遅れて届くAI応答、参照選択と省略、適用失敗、複製の対象切替・型付き変数・同一キーでの再試行・pollingとinvalidationを確認した。

5項目すべての独立レビューと全体レビューで、修正必須の指摘はなかった。最終レビューで記録されたテスト出力の軽微な3項目は、4ファイルのfixtureと期待ログの検証を修正して解消した。アプリケーションの処理や既存の振る舞いの検証は維持している。

## PR一覧

前のPRのブランチをbaseにしたdraft PRで、表の順にレビュー・取り込みできる。各差分は担当する変更に分けている。

| PR                                                        | 変更                                    | 実装コミット |
| --------------------------------------------------------- | --------------------------------------- | ------------ |
| [#7](https://github.com/martech-oss/open-engage/pull/7)   | アーキテクチャ検査の分割                | `bb58553`    |
| [#8](https://github.com/martech-oss/open-engage/pull/8)   | Projectsの互換Repository撤去            | `102b4e1`    |
| [#9](https://github.com/martech-oss/open-engage/pull/9)   | Reportsの互換Repository撤去             | `50ce6bd`    |
| [#10](https://github.com/martech-oss/open-engage/pull/10) | Dealsの互換Repository撤去               | `36c0f07`    |
| [#11](https://github.com/martech-oss/open-engage/pull/11) | Messagingの互換Repository撤去           | `ac4fc4f`    |
| [#12](https://github.com/martech-oss/open-engage/pull/12) | Contactsの互換Repository撤去            | `3889025`    |
| [#13](https://github.com/martech-oss/open-engage/pull/13) | Segmentsの互換Repository撤去            | `9550fa7`    |
| [#14](https://github.com/martech-oss/open-engage/pull/14) | Webの互換Repository撤去                 | `ce71d99`    |
| [#15](https://github.com/martech-oss/open-engage/pull/15) | Automationsの互換Repository撤去         | `632633b`    |
| [#16](https://github.com/martech-oss/open-engage/pull/16) | Web command・公開・生成処理の分離       | `b18e88d`    |
| [#17](https://github.com/martech-oss/open-engage/pull/17) | Automationの実行制御とruntime接続の分離 | `f2da3a2`    |
| [#18](https://github.com/martech-oss/open-engage/pull/18) | Automation AI・施策複製UIの分離         | `04dadc7`    |

README・本書と仕上げの検証は[PR #19](https://github.com/martech-oss/open-engage/pull/19)に分け、UIのPR #18をbaseにしている。

Web RepositoryのPRでは既存の統合テスト2件がCIの5秒制限で一度時間切れになったが、コードや制限時間を変えずに再実行して成功した。

## 実施判断

- 既存の専用ブランチ`refactor20260911`で作業し、ユーザーのワークスペースに変更を残した。別checkoutでの分離が必要になった場合は、変更をworktreeへ移す作業が必要になる。
- 変更を順に積んだdraft PRに分割した。依存順を変える場合は、取り込み前にPRのbase調整が必要になる。
