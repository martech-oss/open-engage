# HubSpot Marketing Hub 機能ギャップ分析

OpenEngageには、**フォーム獲得 → 動的セグメント → スコア → 営業引き渡し → 受注・施策成果測定**をつなぐ基盤が既にあります。Marketing Hubとの差が大きいのは、顧客データの運用管理、集客チャネルとの接続、分析の自由度、会社単位の施策、多人数での管理です。メール機能を追加しなくても、この領域には開発する価値があります。

- 調査日：**2026-09-09（Asia/Tokyo）**。
- 対象：OpenEngage `v0.1.0`、コミット **`12edffd6e6e70c1b9aa4fd6577f1ce26ada7315b`**。調査開始時の作業ツリーに変更なし。
- 比較：HubSpot Marketing Hubの無料共通機能からEnterpriseまで。提供条件は調査時点の公式資料による。
- 成果物：機能差と開発優先度。アプリケーション、API、DBの変更は含まない。

## 1. 結論

1. **既存のMA基盤を作り直す必要はない。** 条件付きフォーム、会社・商談・行動を使うセグメント、カテゴリ別スコア、定期バッチ、再参加、共通Automation、営業担当の順番割り当て、施策複製まで存在する。関連する統合テストも今回実行した。
2. **「部分実装」の改善を優先する。** カスタム項目は保存・条件利用できるが定義の管理画面がない。会社情報AIは調査結果を提示できるが、反映できるのは会社名・ドメイン。流入情報を保存していても、流入元別に集客から受注まで分析する画面はない。
3. **分析と獲得の不足はメールと独立している。** スコア減衰、初回訪問者向けCTA、流入元別の成果、任意条件のレポートは、現在のフォーム・計測・営業連携を直接改善する。
4. **Hub間の境界を守る。** ページA/Bテストとページ内Smart Contentは、現在の公式ナレッジベースではContent Hubの対象。これらをMarketing Hubの不足に数えない。一方、CTA自体のA/Bテスト（ベータ）とSmart ContentはMarketing Hub Professional以上の対象である。[ページA/B][h-page-ab]・[ページSmart Content][h-smart]・[CTA A/B][h-cta-ab]・[CTA Smart Content][h-cta-smart]

## 2. 対象・判定方法

### 除外と製品境界

| 区分                       | この調査での扱い                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing Mailと派生機能   | 一斉送信、販促ドリップ、メール専用テンプレート・A/B・送信時刻最適化・到達率・購読管理は対象外。既存Transactionalメールは削除・改修しない。         |
| 非メールでも使う共通機能   | フォーム、セグメント、スコア、自動化、費用・成果分析は対象。メール機能が同じ画面・型に含まれていても共通機能全体を除外しない。                     |
| SaaS運営・認証             | Google/Microsoftログイン、SSO/SCIM、課金・契約・シート・プラン制限は対象外。業務上の権限・承認・監査・ブランド管理は対象。                         |
| 外部サービス連携           | 広告、Search Console、CRM、イベント等は対象。業務連携のOAuthを、ログイン機能と混同しない。                                                         |
| 別Hub専用機能              | Content Hubのページ最適化、Data Hub専用の一括重複処理・特定イベント取り込み、Sales Hub専用の商談AIスコア等をMarketing Hubの不足として数えない。    |
| 現行方針で対象外のチャネル | SMSは差分を記録したうえで見送り。LINE・PushはOpenEngageでも対象外で、Marketing Hub標準の直接比較にも追加しない。WhatsAppは未実装として別評価する。 |
| 商用サービス・提供量       | SLA、サポート、アカデミー、巨大な連携マーケットプレイスの件数、HubSpotと同量の処理保証を機能差に換算しない。                                       |

**実装済み**は行に記載した能力の実装を確認した意味であり、HubSpotとの完全互換、同じ操作感、同じ処理規模を意味しない。**部分実装**は利用できる範囲と不足を併記する。**未実装**は関連する型・契約・実行処理・UIを調べて該当機能を確認できなかったもの。**対象外**は上記の方針または別製品の機能。**未確認**は資料・検証の限界を指し、未実装とは区別する。

表中の **F / S / P / E** は共通無料機能 / Starter / Professional / Enterprise。`P+` はProfessionalとEnterpriseを指す。既存契約、段階的提供、地域、接続先条件で利用可否が変わるため、API・個別機能の詳細はリンク先を優先する。[製品カタログ][h-catalog]はエディションの列とチェックマークまで確認した。単に抽出テキストに機能名があるだけで全プラン対応とは判定していない。

`E01`等は[コード・テスト根拠](#5-コードテスト根拠)への参照。優先度の「—」は、その行の基本能力について新規開発を推奨しないことを表す。行を細分化するほど件数が変わるため、単純な機能充足率は算出しない。

## 3. 機能マトリクス

### 3.1 顧客データ・セグメント

| ID・機能                              | HubSpot：提供条件・出典                                                                           | OpenEngage | 対応範囲と残る差                                                                                                                                                                         | 根拠                     | 優先度・条件                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| D01 コンタクト・会社・履歴            | F〜。標準レコードとプロパティ。[項目][h-properties]・[重複判定][h-dedup]                          | 実装済み   | Contact/Company、主所属・役職、タグ、活動・スコア履歴、CSV入出力、一括タグ操作等を提供。営業向け専用製品全体との同等性は主張しない。                                                     | [E01](#e01)              | —                                            |
| D02 カスタム項目の管理                | F〜、拡張設定はプラン依存。[項目][h-properties]                                                   | 部分実装   | ContactのJSON項目、フォーム入力、セグメント・グレード条件は使える。定義テーブルはあるが、型・ラベル・選択肢を中央管理するCRUD契約/UIを確認できない。Company編集APIも名前・ドメイン中心。 | [E01](#e01)・[E02](#e02) | **高**：既存データを運用可能にする。         |
| D03 重複候補の確認・統合              | 自動一致はF〜、候補管理はP+。一括候補処理はData Hub P+。[一致][h-dedup]・[候補管理][h-duplicates] | 部分実装   | Workspace内でemail、external ID、会社domainの一意性を維持。別メール・表記揺れの同一人物を候補提示し、関連履歴を保って統合する画面・コマンドはない。単純一致と名寄せを分けて評価。        | [E01](#e01)・[E20](#e20) | 中：履歴・施策参加・同意の統合ルールが必要。 |
| D04 静的リスト・動的Contactセグメント | F〜、条件や数量はプラン依存。[セグメント][h-segments]                                             | 実装済み   | AND/OR、会社・商談・イベント・経過時間・カテゴリスコア・施策参加条件、変更時の再評価と定期補正を提供。過去の比較資料の「少数の属性条件のみ」という評価は適用しない。                     | [E03](#e03)              | —                                            |
| D05 Company等を主対象にするセグメント | 複数オブジェクトを対象化。条件はプラン依存。[セグメント][h-segments]                              | 部分実装   | Company/Dealの属性を使って**Contactを抽出**できる。Company自体を構成員にするセグメントや、独立した会社向け配信・処理対象はない。                                                         | [E03](#e03)              | 中：ABM・会社Automationとまとめて検討。      |
| D06 計算項目・関連レコード集計        | P+。[計算・rollup][h-calculation]                                                                 | 未実装     | 金額や履歴から算出される定型指標はあるが、利用者が式・関連件数・合計を項目として定義する機能はない。                                                                                     | [E02](#e02)・[E20](#e20) | 中：項目定義管理が先。                       |
| D07 カスタムオブジェクト              | E。[Custom objects][h-objects]                                                                    | 未実装     | 業務モデルはコードで定義されたContact/Company/Deal/Project等に固定。管理画面から新しいエンティティや関係を増やせない。                                                                   | [E01](#e01)・[E20](#e20) | 低：D1クエリ・権限・UIへの影響が大きい。     |
| D08 ABM・ターゲット企業               | P+。[ABM][h-abm]                                                                                  | 部分実装   | 会社関連、会社条件でのContact抽出はある。Target Account、購買関与者の役割、ICP tier、会社別エンゲージメント・専用ダッシュボードはない。任意項目で代用しても専用運用は別途必要。          | [E01](#e01)・[E03](#e03) | 中：B2Bの会社単位運用が必要な場合。          |

### 3.2 集客・獲得

| ID・機能                               | HubSpot：提供条件・出典                                                                                                                                                            | OpenEngage                           | 対応範囲と残る差                                                                                                                                                                                          | 根拠                     | 優先度・条件                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------- |
| A01 公開・埋め込み・外部フォーム       | F〜。高度な条件分岐はP+。[フォーム][h-forms]                                                                                                                                       | 実装済み                             | フォーム編集・公開版、埋め込み、外部Form HandlerのPOST、項目マッピング、許可Origin、成功・失敗時URLを提供。既存外部フォームの自動検出・無改修収集は別機能で、未実装。                                     | [E04](#e04)              | —：自動検出収集は低。                           |
| A02 多段階フォーム                     | S+の機能としてカタログに掲載。[フォーム][h-forms]                                                                                                                                  | 未実装                               | 現在は1回の送信を前提とする項目配列。ステップの定義・戻る/次へ・ステップ別離脱分析はない。Progressive Profilingは再訪時の質問変更であり、多段階フォームとは異なる。                                       | [E04](#e04)              | 中：長い問い合わせ・申込フォームで有効。        |
| A03 項目の条件付き表示・既知回答の省略 | 条件付きロジック等はP+。[フォーム][h-forms]                                                                                                                                        | 実装済み                             | `visibleWhen` / `requiredWhen`、カスタム項目、既知回答を省くProgressive Profilingを提供。既知情報の利用には訪問者の同意とメール一致が必要。HubSpotの新旧フォームの方式と完全同一ではない。                | [E04](#e04)              | —                                               |
| A04 フォームのスパム対策               | 標準検証、高度な検証、AI判定ベータは条件付き。[フォーム][h-forms]・[カタログ][h-catalog]                                                                                           | 部分実装                             | Turnstile、honeypot、入力検証、再送の冪等性を実装。設定済みTurnstileの資格情報不足時は公開・送信を拒否。AIスパム判定や判定結果の審査画面はない。                                                          | [E04](#e04)              | 低：既存対策が先に使える。                      |
| A05 CTA・ポップアップ                  | S+、高度なターゲティングはP+。[CTA][h-cta]                                                                                                                                         | 部分実装                             | Site Messageの文面・CTA・URL条件・掲載期間・表示/クリック計測と公開フォーム表示方式がある。ただしSite Messageの配信APIは同意済みかつContact識別済みの訪問者に限定される。初回匿名訪問者の獲得用途に不足。 | [E05](#e05)              | **高**：既存の表示基盤を初回獲得に使う。        |
| A06 CTA単体の出し分け・A/B             | Smart CTAはP+。CTA A/BはP+のベータ参加が必要。[出し分け][h-cta-smart]・[A/B][h-cta-ab]                                                                                             | 未実装                               | LP全体の比較・動的スロットは存在するが、独立したCTAのバリアント、属性別表示、CTA単位の実験レポートはない。ページ実験の存在だけで対応済みにしない。                                                        | [E05](#e05)・[E06](#e06) | 中：A05の獲得用途を整えた後。                   |
| A07 LP作成・公開                       | 基本作成・公開はF〜。AIページ生成・ページA/B・ページSmart ContentはContent Hub P+で、後者は参考扱い。[ページ作成][h-page-create]・[ページA/B][h-page-ab]・[Smart Content][h-smart] | 実装済み（高度なページ機能は対象外） | OpenEngageはAIによるLP作成・修正、公開snapshotを提供。さらに2〜5案の比較、セグメント別HTML表示もある。基本LPを比較に含め、高度なContent Hub機能の不足は数えない。詳しい制約はE06。                        | [E06](#e06)              | —：自動配分最適化等を本比較から追加要求しない。 |
| A08 Asset・動画                        | ファイル管理、P+に動画関連機能。[カタログ][h-catalog]                                                                                                                              | 部分実装                             | R2 Assetの保存・管理・公開URL、画像・文書・動画等の種別はある。動画を保存できることと、専用プレーヤー内CTA・視聴進捗の成果分析は異なる。後者は確認できない。                                              | [E07](#e07)              | 低：専用動画基盤は運用負担が大きい。            |

### 3.3 計測・同意

| ID・機能                                   | HubSpot：提供条件・出典                                                                           | OpenEngage | 対応範囲と残る差                                                                                                                                                                          | 根拠                                  | 優先度・条件                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| M01 訪問履歴とContactの紐付け              | 計測コードとCRMを接続。[Web分析][h-traffic]・[識別][h-dedup]                                      | 実装済み   | 署名Visitor token、匿名履歴の後続紐付け、識別assertion、別人への切替・Workspace越境拒否を実装。全端末で自動的に人物統合されるとの保証はない。                                             | [E08](#e08)                           | —                                          |
| M02 カスタムイベント                       | P+。定義・プロパティ・分析。Webhookからの特定取り込み方法はData Hub P+。[Custom events][h-events] | 部分実装   | 公開トラッキング/APIのイベントを履歴・スコア・セグメント・Automationで利用可能。利用者がイベント定義・必須プロパティ・発火状況を一元管理する画面やノーコード要素選択器はない。            | [E08](#e08)・[E03](#e03)・[E20](#e20) | 中：分析対象イベントの品質を揃える。       |
| M03 流入元・セッション・コンバージョン分析 | 詳細分析はP+。[Web traffic][h-traffic]                                                            | 部分実装   | LPのURL・referrer・UTMを計測コンテキストに保存し、PV・訪問者・フォーム・上位ページを集計。チャネル分類、セッション、流入元別CV・受注分析はない。「UTM保存なし」という評価は誤り。         | [E08](#e08)・[E09](#e09)              | **高**：施策判断の材料を増やす。           |
| M04 Cookie・追跡同意                       | F〜。地域・言語・カテゴリ・GPC対応。[Consent banner][h-cookie]                                    | 部分実装   | LPには許可/拒否/撤回UIがあり、外部トラッキングも明示的な同意を要求する。汎用の外部サイト用バナー管理、国別規則、カテゴリ別許可、GPC解釈、同意の版管理は確認できない。購読設定とは別評価。 | [E08](#e08)                           | 中：外部サイト・広告連携を広げる前に対応。 |
| M05 計測用URL・リンク                      | キャンペーンの計測URL等。[施策詳細][h-campaign-detail]                                            | 実装済み   | Custom Redirectで外部リンクへの遷移・反応・スコア・Project接点を記録。署名されたVisitor情報がない匿名クリックはContactに紐付かない。広告管理コネクタの代わりにはならない。                | [E08](#e08)・[E10](#e10)              | —                                          |

### 3.4 自動化・営業連携

| ID・機能                             | HubSpot：提供条件・出典                                                                                                     | OpenEngage | 対応範囲と残る差                                                                                                                                                              | 根拠                     | 優先度・条件                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| W01 非メールのビジュアルWorkflow     | P+。[Workflows][h-workflows]                                                                                                | 実装済み   | 条件、期限付きイベント待ち、相対/絶対/稼働時間帯のDelay、項目・タグ・スコア更新、Webhook、営業引き渡し、施策参加更新を提供。                                                  | [E11](#e11)              | —                                                  |
| W02 定期実行・再参加・共通処理・履歴 | P+。利用可能なアクション等はプラン依存。[Workflows][h-workflows]                                                            | 実装済み   | バッチ対象プレビュー、日/週/月の定期実行、再参加・cooldown、子フローの完了待ち/非同期呼び出し、取消、実行履歴、回復処理を提供。                                               | [E11](#e11)              | —                                                  |
| W03 会社・商談を主対象にしたWorkflow | P+、一部オブジェクトは追加条件。[Workflows][h-workflows]                                                                    | 部分実装   | Company/Deal条件は参照できるが、実行主体はContact。会社全体を1回だけ処理するフローや、任意の関連オブジェクト更新には対応していない。                                          | [E03](#e03)・[E11](#e11) | 中：D05/D08と同時に設計。                          |
| W04 行動・属性・カテゴリ別スコア     | P+。[Lead scoring][h-scoring]                                                                                               | 実装済み   | イベント一致による加減点、カテゴリ別点数、URL閲覧のPage Action、A〜Fの属性グレード、履歴を提供。HubSpotのFit数値スコアとA〜Fは異なる表現。                                    | [E12](#e12)              | —                                                  |
| W05 スコアの鮮度・制御               | P+。減衰、期間・頻度、総点/グループ上限。[Lead scoring][h-scoring]                                                          | 部分実装   | 加点・減点・手動調整・Automationでのsetはあるが、イベントごとの経年減衰、期間内回数、上限の設定、ルール改定時の全件再計算はない。非活動フローで減点しても同等の減衰ではない。 | [E12](#e12)              | **高**：古い反応・繰り返し閲覧の過大評価を抑える。 |
| W06 ライフサイクル                   | 基本段階はF〜、自動化は条件付き。[Lifecycle][h-lifecycle]                                                                   | 部分実装   | lead/mql/sql/customerの実到達時刻、段階スキップ、進捗集計がある。自由な`stage`属性と、この固定4段階の`lifecycleStage`は別。会社ライフサイクルや任意の到達段階定義はない。     | [E13](#e13)              | 中：現在の4段階で不足する業務がある場合。          |
| W07 担当者・タスクへの引き渡し       | 基本CRM＋P+のWorkflowで営業接続。特定の営業アクションの契約条件は別確認。[Lifecycle][h-lifecycle]・[Workflows][h-workflows] | 実装済み   | 担当者・タスク・アプリ内通知の一括保存、固定/round-robinグループ、有効な既存担当の維持、再試行時の二重作成防止まである。グループはコンテンツ閲覧権限のTeamsとは別。           | [E13](#e13)              | —                                                  |

### 3.5 施策管理・分析

| ID・機能                                 | HubSpot：提供条件・出典                                                                | OpenEngage | 対応範囲と残る差                                                                                                                                                                                 | 根拠                                  | 優先度・条件                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------- |
| R01 キャンペーン・参加者・再利用         | CampaignsはP+。外部イベントは連携条件付き。[Campaigns][h-campaigns]・[Zoom][h-zoom]    | 実装済み   | Projectで関連リソース・参加ステータス・成果・獲得元・履歴・参加日コホートを管理。施策一式の複製、共通変数、公開時の版固定を提供。HubSpotのProjectsオブジェクトとの比較ではない。                 | [E14](#e14)                           | —                                                       |
| R02 予算・費用・ROI                      | P+。[Budget][h-budget]                                                                 | 部分実装   | 計上日・分類・通貨付き費用とROIを提供。予算明細・残予算・予実管理、広告費の自動同期はない。通貨は別集計で、自動換算しない。                                                                      | [E10](#e10)                           | 中：手動費用入力の次の段階。                            |
| R03 接点・獲得・売上アトリビューション   | Contact獲得はP+、商談獲得/売上はE。[Attribution][h-attribution]                        | 部分実装   | Project接点の関与売上・初回・最終接点を計算。ROIで選べるのは初回/最終。任意チャネルの複数接点モデル、Contact/Deal獲得別のモデル比較はない。Projectに関連付かない一般PVはそのまま接点にならない。 | [E10](#e10)                           | 中：M03の接点品質を整えた後。                           |
| R04 定型レポート・進捗                   | ダッシュボード、分析機能はエディション依存。[Web分析][h-traffic]・[Journey][h-journey] | 実装済み   | Contact、Automation、Deals、Site、Campaign、Lifecycleの定型レポートとCSV出力。到達率・所要日数中央値、施策参加コホートまである。日付範囲等の指定はできる。                                       | [E09](#e09)・[E13](#e13)・[E14](#e14) | —                                                       |
| R05 カスタムレポート・保存ダッシュボード | P+。[Report builder][h-report-builder]                                                 | 未実装     | データソース・集計軸・指標・フィルタを利用者が選び、名前を付けて保存・共有するレポートビルダーはない。定型レポートの期間指定と区別する。                                                         | [E09](#e09)・[E20](#e20)              | **高（限定版）**：任意SQLより既存指標の組み合わせから。 |
| R06 任意イベントのジャーニー分析         | ContactベースはE。DealベースはSales Hub E。[Journey][h-journey]                        | 部分実装   | 固定ライフサイクルと施策参加コホートはあるが、利用者が複数の接点を順序付きで選び、段階間CV・離脱・所要時間を比較する画面はない。                                                                 | [E09](#e09)・[E13](#e13)              | 中：M02/M03/R05の後。                                   |
| R07 カレンダー・コメント・施策横断作業   | P+。[Campaigns][h-campaigns]・[カタログ][h-catalog]                                    | 部分実装   | ブリーフの担当・承認・レビュー予定、営業タスクはある。マーケティングカレンダー、資産へのコメント、施策横断の制作タスク管理はない。                                                               | [E14](#e14)・[E17](#e17)              | 中：複数人の運用が増えた時点。                          |

### 3.6 外部チャネル・連携

| ID・機能                                | HubSpot：提供条件・出典                                                                             | OpenEngage       | 対応範囲と残る差                                                                                                                                                        | 根拠                                  | 優先度・条件                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| X01 広告管理・リード/オーディエンス同期 | 基本接続F〜、同期・管理はS〜と条件付き。[Google Ads][h-ads]・[カタログ][h-catalog]                  | 未実装           | Google/Meta/LinkedIn等の広告コネクタ、リード広告取り込み、対象者同期、広告管理UIはない。計測リンクとWebhookだけではネイティブ同期ではない。                             | [E15](#e15)・[E20](#e20)              | 中：利用者自身の広告アカウント・認可が必要。       |
| X02 オフライン/CRMコンバージョン返送    | S+、広告接続・識別情報等が必要。[Conversion sync][h-ad-conversion]                                  | 未実装           | MQL/SQL/受注の情報はあるが広告媒体に返せない。UTMと広告クリックID・媒体イベントIDは別のデータ。                                                                         | [E08](#e08)・[E13](#e13)・[E20](#e20) | 中：M03/M04を整え、まず1媒体。                     |
| X03 SNS投稿・予約・反応管理             | P+。接続先アカウントが必要。[Social][h-social]                                                      | 未実装           | SNSアカウント、投稿ジョブ、公開API、返信・反応の取り込みを確認できない。SkillファイルにSNSの記述があっても製品連携とは数えない。                                        | [E16](#e16)・[E20](#e20)              | 低：媒体ごとの保守負担が大きい。                   |
| X04 Search Console・SEO分析             | GSC連携/SEOツールはP+、ページ単位の助言はF〜。[GSC][h-gsc]・[SEO][h-seo]                            | 未実装           | LPのtitle/description等はあるが、検索語・表示/クリック/順位の取り込み、サイト巡回によるSEO指摘、トピック分析はない。                                                    | [E06](#e06)・[E20](#e20)              | 中：GSC読み取りから。サイト所有権・API接続が必要。 |
| X05 ライブチャット・会話受信箱・ボット  | 基本チャットF〜、分岐等はプラン依存。[Live chat][h-chat]・[カタログ][h-catalog]                     | 未実装           | 管理者向けAI会話やSite Messageは、訪問者と担当者の双方向会話ではない。Inbound Emailの保存も、チャットを統合した担当者向け受信箱とは異なる。                             | [E05](#e05)・[E16](#e16)・[E20](#e20) | 低：会話履歴・有人対応・運用時間の設計が必要。     |
| X06 Webinar/イベント連携                | 基本Zoom連携F〜、Zoom側Webinar追加契約・機能別条件あり。[Zoom][h-zoom]                              | 部分実装         | Project参加ステータス、フォーム登録、CSV/APIで参加者を管理できる。Zoom等の登録・出席・取消の自動同期コネクタはない。                                                    | [E14](#e14)・[E20](#e20)              | 中：既存Programに1サービスを接続する方式。         |
| X07 外部CRM・Salesforce同期             | Salesforce連携P+、Custom Object同期E。[カタログ][h-catalog]                                         | 部分実装         | 自前Deals CRM、REST/SDK/MCP、外部イベント、Outbound Webhookを提供。双方向差分同期・フィールドマッピング・競合解決を持つ製品別コネクタはない。                           | [E13](#e13)・[E15](#e15)              | 低：外部CRMとの併用需要が確定してから。            |
| X08 SMS                                 | P+＋SMS Add-on、地域・番号条件あり。[SMS][h-sms]                                                    | 対象外（未実装） | READMEでSMSを対象外と明記。Cloudflare Emailの制約をSMSに一般化した判断ではなく、既存方針と別プロバイダー依存による見送り。HubSpot側は北米の番号・利用地域に制約がある。 | [E20](#e20)                           | **見送り**                                         |
| X09 WhatsApp                            | P+、WhatsApp Business等の接続要件あり。[WhatsApp][h-whatsapp]                                       | 未実装           | メッセージ送受信・テンプレート・チャネル別同意・受信箱がない。                                                                                                          | [E15](#e15)・[E20](#e20)              | 低：利用地域と顧客需要が明確な場合。               |
| X10 API・拡張入口                       | CRM/製品API。個別操作は権限・プラン依存。[Campaign API案内][h-campaigns]・[Event API案内][h-events] | 実装済み         | 共通oRPC契約、REST、TypeScript SDK、Workspace APIキー、MCP、イベント投入・Webhookがある。HubSpot API互換ではない。これを足場に連携を個別追加できる。                    | [E15](#e15)                           | —                                                  |

### 3.7 AI支援

| ID・機能                             | HubSpot：提供条件・出典                                                                                    | OpenEngage               | 対応範囲と残る差                                                                                                                                                                    | 根拠                     | 優先度・条件                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| I01 施策・セグメント・Automation生成 | Workflow生成P+。セグメントAI生成は有料プラン等の条件あり。[Workflows][h-workflows]・[Segments][h-segments] | 実装済み（外部AIが必要） | 専用Agent、構造化提案、型/参照の検証、下書き反映、施策ブリーフ承認を提供。LP生成もある。AIの出力品質・実プロバイダーの稼働は今回未確認。                                            | [E16](#e16)・[E17](#e17) | —                                                  |
| I02 Contact/Companyの情報補完        | S+、対象データ・設定に条件あり。[Enrichment][h-enrichment]                                                 | 部分実装                 | 会社のWeb調査と出典付き提案を提示。画面から保存する選択は会社名・ドメインに限定。Contact属性の補完、提案された会社の全属性をCRM項目に保存、定期的な全件更新はない。初期状態で無効。 | [E16](#e16)              | 中：D02の項目管理後、出典付き保存から。            |
| I03 AIスコア・会社集約評価           | 会社ルールスコアP+、ContactのAIスコアE。[Scoring][h-scoring]                                               | 部分実装                 | 手動ルール・属性グレードはある。会社全体の数値スコアや、成約/非成約の履歴から条件を学習する機能はない。LLMによる施策提案と予測モデルを区別する。                                    | [E12](#e12)・[E16](#e16) | 会社集約は中、予測AIは低：十分な実績データが前提。 |
| I04 Brand context・生成物への反映    | P+。カタログはBrand identityをベータと記載。[Brand context][h-brand-context]・[カタログ][h-catalog]        | 部分実装                 | Workspaceにブランド名・説明・トーン・色等を保存し、LP生成にも渡す。サイト巡回からのブランド文脈更新、ICP/競合の構造化管理、複数ブランド切替はない。                                 | [E16](#e16)・[E19](#e19) | 低：既存プロフィールで基本生成は可能。             |
| I05 SEO/AEO・Content Agent           | AEOはP+または別AEO契約。AEO/関連Content Agentはベータ。[AEO][h-aeo]                                        | 未実装                   | 回答エンジンへの定期プロンプト実行、言及・引用・競合比較、推薦からの専用コンテンツ作成ループはない。AIによるLP生成とは別。                                                          | [E16](#e16)・[E20](#e20) | 低：評価データ・外部実行費用が必要。               |
| I06 汎用Agent Builder・顧客対応Agent | P+、ベータ/HubSpot Credits等の条件付き。[Agent Hub][h-agent-hub]・[カタログ][h-catalog]                    | 部分実装                 | 開発者が追加する固定用途のFlue Agentはある。利用者がツール・知識・動作をGUIで組み立てる機能、公開サイトの顧客対応Agentはない。                                                      | [E16](#e16)              | 低：専用Agentの運用品質を先に整える。              |

### 3.8 業務管理

| ID・機能                       | HubSpot：提供条件・出典                                                                                  | OpenEngage | 対応範囲と残る差                                                                                                                                                                 | 根拠                     | 優先度・条件                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| G01 業務権限・チーム・項目制限 | Teams P+、階層・高度な分割はE。[Teams][h-teams]・[カタログ][h-catalog]                                   | 部分実装   | Workspace分離と固定5ロール、サーバーでの権限制御はある。カスタム権限セット、チーム/資産/レコードごとの表示範囲、項目単位の編集制限はない。営業割り当てグループでは代替できない。 | [E18](#e18)              | 中：複数チームで同じWorkspaceを使う場合。    |
| G02 承認・共同作業             | Campaign共同作業P+、Social承認E。メール承認は除外。[Campaigns][h-campaigns]・[カタログ][h-catalog]       | 部分実装   | 施策ブリーフの申請・承認・差し戻し、担当者・版・承認済みsnapshotを提供。全資産共通の承認エンジン、複数段階承認、SNS投稿承認はない。既存の承認がないという評価はしない。          | [E17](#e17)              | 中：まず非メール資産の公開権限との接続。     |
| G03 業務変更の監査・検索・出力 | S/Pは主にログイン/セキュリティ、Eで承認・Workflow等を拡大。Content履歴のexportは別条件。[Audit][h-audit] | 部分実装   | 操作者・APIキー・アクション・対象・metadataを監査テーブルへ記録。全業務更新の記録網羅性は未確認。監査一覧/検索/exportの管理API・UIを確認できない。                               | [E18](#e18)              | 中：既存記録を管理者が利用できるようにする。 |
| G04 複数ブランド               | E＋Brands Add-on。[Brands][h-brands]                                                                     | 部分実装   | Workspaceごとのデータ分離・ブランドプロフィールはある。同じ顧客基盤内でブランドを分ける運用、ブランド別資産・権限・横断分析はない。Workspaceを増やす方式は共有CRMとは異なる。    | [E18](#e18)・[E19](#e19) | 低：複数ブランド需要が出てから。             |

## 4. 開発優先度

以下は機能比較からの**提案**であり、実装済み機能や確定した開発計画ではない。非メール業務への効果、既存実装の再利用、開発・保守負担、Cloudflareでの実現性、外部依存を判断軸とした。人数・期間・実データ分布が未提示のため、工数の数値見積もりは行わない。

### 優先度：高

| 順序・候補                       | 解決する課題と最小限の追加範囲                                                                                                      | 既存資産・依存条件                                                                                               | 負担の見立て                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1. カスタム項目を中央管理（D02） | Contact/Companyの項目定義、型・選択肢・ラベル、値の入力、利用箇所の確認を管理画面で扱う。フォーム・セグメントが同じ定義を利用する。 | 既存定義テーブルとJSON値を利用。既存の未定義キーを破壊せず扱う方針が必要。                                       | 中。外部サービス不要。          |
| 2. 流入から成果までの分析（M03） | 既存UTM/referrerをチャネル別に集計し、フォーム・MQL・受注の結果を同じ軸で確認できるようにする。計測不能/不明も表示する。            | Visitor・測定コンテキスト・Project・実到達履歴を接続。セッションの定義、既存データの再集計可能範囲を先に決める。 | 中〜大。D1の集計量を制御する。  |
| 3. 初回訪問者向けCTA（A05）      | Contact識別前でも表示可能なCTA、表示条件、再表示制御を整える。表示可否と個人計測の同意を分離し、フォーム獲得へつなぐ。              | Site Message・埋め込みフォーム・リンク計測を利用。匿名での表示を、無同意の個人追跡に拡張しない。                 | 中。まず既存サイト内で完結。    |
| 4. スコアの鮮度・上限（W05）     | 期間内の行動、ルール/カテゴリの上限、経年減衰、改定後の再計算を段階的に提供する。                                                   | スコア履歴・カテゴリ・Cronを利用。二重適用を防ぎ、元イベントの保持期間と再計算範囲を揃える。                     | 中〜大。外部AIは不要。          |
| 5. 保存できる限定レポート（R05） | 既存の指標・集計軸・条件を選んで名前付きで保存し、共有・CSV出力できるようにする。                                                   | 定型レポートと型付き条件を再利用。最初から任意SQL、無制限JOIN、汎用BIを作る必要はない。                          | 中〜大。M03とデータ定義を共有。 |

### 優先度：中

- **同意管理（M04）**：LPの既存UIを土台に外部サイト用設定、同意カテゴリ・文面の版・GPCを整える。広告へのデータ返送を実装する場合は、その先行条件とする。
- **重複統合（D03）**：人が選ぶ候補確認とプレビュー付き統合から始める。履歴・商談・参加ステータス・スコア・同意をどう残すかが主要な負担。
- **多段階フォーム・CTA実験（A02/A06）**：長い申込やCTAの改善需要に応じて追加。LP実験の実装を再利用しても、成果の単位・表示の単位をCTA用に定義する。
- **ABM・会社処理（D05/D06/D08/W03/I03）**：まずTarget Account・購買役割・会社別集計。汎用Custom Objectより既存Companyを活かす。
- **予実・アトリビューション・ジャーニー（R02/R03/R06）**：正しい接点と費用が取れる範囲から拡張。関与売上を配分売上と足し合わせない。
- **コネクタ（X01/X02/X04/X06）**：Google Adsへの成果返送、Search Console読み取り、Webinar参加同期のうち実需要のあるものを1つ選ぶ。ユーザー所有の認証情報、再同期、失効・レート制限、重複排除が必要。対象媒体未選定のため現段階で着手先は確定しない。
- **会社情報の保存範囲（I02）**：調査提案を出典・確認日時とともに定義済みCompany項目へ保存する。D02が先。外部AIの料金・稼働に依存する。
- **権限・承認・監査（G01/G02/G03）**：同じWorkspaceを複数チームで使う段階で強化。固定ロールを即座に汎用権限エンジンに置き換えるより、資産の公開と監査参照の需要を具体化する。

### 優先度：低・見送り

Custom Objects、汎用BI、全SNS対応、双方向CRM同期、独自チャット/受信箱、予測AI、AEOの常時計測、動画最適化、複数ブランド共有CRMは、既存基盤の改善後に再評価する。Cloudflare上にアプリを置けても、外部媒体のAPI、データ、モデル費用まで不要になるわけではない。

SMSは現行方針に沿って見送り。Marketing Mail・その派生機能、SaaS課金・認証の追加、Content Hub専用の高度なページ機能は、この比較を理由とした追加対象にしない。

### 非メールの業務フローで見る優先順位

| 段階         | 現在できること                                        | 次に不足すること                           |
| ------------ | ----------------------------------------------------- | ------------------------------------------ |
| 獲得         | LP・フォーム・外部Form Handler、同意付き訪問履歴      | 初回訪問者向けCTA、多段階フォーム          |
| 理解・分類   | 属性・会社・商談・最近の行動・施策進捗でContactを抽出 | 項目定義の運用UI、会社単位の対象管理       |
| 優先順位付け | 行動加減点・カテゴリ点数・属性グレード                | 鮮度・上限・改定後再計算                   |
| 営業引き渡し | 固定/順番割り当て、タスク・通知の一括作成             | 会社単位の判断、業務に合わせた到達段階     |
| 成果判断     | 受注、費用、初回/最終接点、進捗・参加コホート         | 流入元別成果、保存レポート、任意ジャーニー |

## 5. コード・テスト根拠

リンクはこのドキュメントからのリポジトリ相対パス。テストを読んだことと実行したことは、次節で区別する。以下の実装範囲からの推論を含む未実装判定は、将来の追加コードや外部プラグインの不可能性を主張するものではない。

### E01

**CRM・関連・一意性。** [Contact/Companyスキーマ](../../packages/database/src/contacts/schema.ts)、[Contact CRUD](../../packages/database/src/contacts/repository.ts)、[Company CRUD](../../packages/database/src/contacts/company-repository.ts)、[プロフィール・一括操作の型](../../packages/core/src/contacts/resource-schema.ts)、[Contact API](../../apps/server/src/contacts/router.ts)、[Company API](../../apps/server/src/contacts/company-router.ts)、[一覧・作成UI](../../apps/client/src/features/contacts/contact-forms.tsx)。email/external ID/domainの一意制約は実在するが、これは異なる識別子の名寄せではない。CSVは[入出力契約](../../packages/orpc/src/operations/contract.ts)と[実行サービス](../../apps/server/src/contacts/import-export-service.ts)を確認。

### E02

**カスタム項目。** [定義テーブル](../../packages/database/src/contacts/schema.ts#L119)にContact/Company、text/number/boolean/date/selectがある。[Segment catalog](../../packages/database/src/segments/catalog-repository.ts)は定義済み項目を読み取る。一方、製品コードにおける`customFieldDefinitions`参照を検索した結果、定義とcatalog読み取り以外のCRUDを確認できなかった。[フォーム項目UI](../../apps/client/src/features/website/form-field-builder.tsx)はキーを直接定義し、キー変更で既存値が孤立する点もコメントされている。[Company更新型](../../packages/core/src/contacts/company-schema.ts)はname/domainのみ。

### E03

**豊富な条件と再評価。** [条件定義](../../packages/core/src/segments/fields.ts#L53)、[AST](../../packages/core/src/segments/schema.ts)、[再評価処理](../../apps/server/src/segments/membership-service.ts)、[再評価Queue](../../apps/server/src/segments/reconciliation-queue.ts)、[UI](../../apps/client/src/features/segments/segment-builder.tsx)。[rich-segments.test.ts](../../apps/server/test/rich-segments.test.ts)は最近の反応・カテゴリ点数・未受注、時間失効、関連する同一Company/Deal行への条件適用を検証する。関連先の条件を使っても返却対象はContact。

### E04

**フォームの定義から送信まで。** [型](../../packages/core/src/web/form-schema.ts)、[項目UI](../../apps/client/src/features/website/signup-form-editor-dialog.tsx)、[条件表示](../../packages/core/src/web/form-conditions.ts)、[送信ユースケース](../../apps/server/src/public/submit-form-use-case.ts)、[Form Handler API](../../apps/server/src/web/form-handler-router.ts)、[外部フォームUI](../../apps/client/src/features/website/form-handlers-panel.tsx)。[form-custom-fields](../../apps/server/test/form-custom-fields.test.ts)、[form-handlers](../../apps/server/test/form-handlers.test.ts)、[Turnstile](../../apps/server/test/public-form-turnstile.test.ts)、[公開フォーム検証](../../apps/server/test/public-form-validation.test.ts)が対応する。再訪時等に既知の回答済み項目を省く機能と、多画面に分ける機能は別。

### E05

**Site Messageの対象制約。** [配信・計測API](../../apps/server/src/public/site-message-routes.ts)は`consent=true`と有効Visitor tokenを要求し、`contactId`がなければ空配列を返す。[実データ取得](../../packages/database/src/web/visitor-message-repository.ts)は公開状態と掲載期間を見て、配信APIがURL条件を適用する。[ブラウザ表示](../../apps/server/src/public/templates.ts)にはsessionStorageによる既出抑止がある。[管理UI](../../apps/client/src/features/website/site-messages-page.tsx)と[website.test.ts](../../apps/server/test/website.test.ts)も確認した。地域・端末別の汎用ターゲティングやCTA実験定義はない。

### E06

**LPの比較・動的表示は実装済み。** [実験/動的HTMLの型](../../packages/core/src/web/optimization.ts)、[選択処理](../../apps/server/src/web/optimization-service.ts)、[保存・集計](../../packages/database/src/web/optimization-repository.ts)、[公開処理](../../apps/server/src/web/landing-design-service.ts)、[管理UI](../../apps/client/src/features/website/landing-optimization-panel.tsx)。2〜5案、配分合計100%、Visitorごとの固定割り当て、最初の実表示から30日以内のフォーム成功を1回計上。同意なしの閲覧は個人単位の実験集計に含めず、終了/採用は手動。動的スロットは既知Contactのセグメントに基づき、匿名はfallback。[実験テスト](../../apps/server/test/landing-optimization.test.ts)・[パーソナライズテスト](../../apps/server/test/landing-personalization.test.ts)を今回実行。

### E07

**Asset。** [種別・サイズ等の型](../../packages/core/src/assets/schema.ts)、[R2サービス](../../apps/server/src/assets/service.ts)、[API](../../packages/orpc/src/assets/contract.ts)、[Assetテスト](../../apps/server/test/assets.test.ts)。動画を含むファイル保存は可能だが、動画向けの視聴解析プロダクトを実装した証拠ではない。

### E08

**追跡・同意・流入情報。** [署名による訪問者識別](../../apps/server/src/web/visitor-identity-service.ts)、[公開tracking](../../apps/server/src/public/tracking-routes.ts)、[LP計測コンテキスト](../../apps/server/src/web/measurement-service.ts)、[LP同意UI](../../apps/server/src/web/landing-renderer.ts)、[外部サイト設定UI](../../apps/client/src/features/website/site-tracking-page.tsx)。`measurement-service.ts`はURL/referrerと5種類のUTMを取り込む。URL文字列の保持と流入元別レポートの存在は別。[visitor-identity](../../apps/server/test/visitor-identity.test.ts)、[custom-redirect](../../apps/server/test/custom-redirect.test.ts)、[tracking-browser](../../apps/server/src/public/tracking-browser.test.ts)が対応する。

### E09

**定型分析。** [Report型](../../packages/core/src/reports/schema.ts)、[API](../../apps/server/src/reports/router.ts)、[Site集計](../../packages/database/src/reports/site-repository.ts)、[画面](../../apps/client/src/features/reports/report-pages.tsx)、[CSV出力](../../apps/client/src/features/reports/report-export.ts)。SiteはPV、unique visitor、フォーム送信、上位ページ等が中心。Site Messageの表示/クリックは保存済み累積カウンタを参照するため、他の期間指定指標と期間基準が同じではない。任意のレポート定義を保存する型・API・UIはない。

### E10

**接点・費用・ROI。** [接点の生成](../../apps/server/src/contacts/campaign-touch-service.ts)、[配賦クエリ](../../packages/database/src/projects/campaign-repository.ts)、[レポート処理](../../apps/server/src/reports/campaigns-report.ts)、[費用型](../../packages/core/src/projects/schema.ts)、[費用UI](../../apps/client/src/features/reports/campaign-costs-panel.tsx)。関与売上は重複を許す参考値で、初回/最終接点の配分売上と合算しない。費用0のROIはnull、通貨別集計。[campaign-attribution](../../apps/server/test/campaign-attribution.test.ts)・[roi-lifecycle-report](../../apps/server/test/roi-lifecycle-report.test.ts)を今回実行。

### E11

**実行可能なAutomation。** [ノード・定期実行の型](../../packages/core/src/automations/schema.ts)、[Worker](../../apps/server/src/automations/worker.ts)、[実行管理API](../../apps/server/src/automations/execution-router.ts)、[共通呼び出し](../../apps/server/src/automations/call-service.ts)、[Editor](../../apps/client/src/features/automations/automation-editor-page.tsx)、[実行履歴UI](../../apps/client/src/features/automations/automation-runs-panel.tsx)。[execution-control](../../apps/server/test/automation-execution-control.test.ts)・[callable-control](../../apps/server/test/automation-callable-control.test.ts)を今回実行。UIのフロー図だけを根拠にした判定ではない。

### E12

**スコア。** [ルール型](../../packages/core/src/scoring/schema.ts)、[イベント評価](../../apps/server/src/scoring/engine.ts)、[ルールUI](../../apps/client/src/features/scoring/scoring-rules-page.tsx)、[グレードUI](../../apps/client/src/features/scoring/scoring-grading-page.tsx)。ルールに減衰・頻度・上限の設定はなく、Companyを主対象とする評価器もない。[scoring-events](../../apps/server/test/scoring-events.test.ts)・[scoring-rules](../../apps/server/test/scoring-rules.test.ts)を今回実行。ルール一致時の反映と、ルール変更時に過去の全対象を再計算する操作は異なる。

### E13

**営業進捗と引き渡し。** [Contact型](../../packages/core/src/contacts/contact-schema.ts)、[到達段階更新](../../packages/database/src/contacts/lifecycle-repository.ts)、[担当・タスク・通知の保存](../../packages/database/src/deals/sales-repository.ts)、[営業API](../../apps/server/src/deals/sales-router.ts)、[進捗レポート](../../apps/server/src/reports/lifecycle-report.ts)、[画面](../../apps/client/src/features/reports/report-views/lifecycle-report-view.tsx)。[sales-handoff](../../apps/server/test/sales-handoff.test.ts)は並行round-robin、担当者の資格失効、既存担当維持、再試行を検証。[roi-lifecycle-report](../../apps/server/test/roi-lifecycle-report.test.ts)は初回到達、段階スキップ、中央値を検証。

### E14

**施策・参加者・複製。** [Program型](../../packages/core/src/projects/program.ts)、[参加者・履歴・cohort](../../packages/database/src/projects/program-member-repository.ts)、[参加者UI](../../apps/client/src/features/projects/program-members-panel.tsx)、[成果UI](../../apps/client/src/features/projects/program-cohort-panel.tsx)、[複製UI](../../apps/client/src/features/projects/clone-panel.tsx)、[共通変数](../../packages/core/src/projects/variables.ts)。[program-members](../../apps/server/test/program-members.test.ts)・[marketo-journey](../../apps/server/test/marketo-journey.test.ts)を今回実行。後者は承認、複製、フォーム獲得、定期バッチ、共通営業処理、cohort成果を通す。

### E15

**拡張入口。** [契約集約](../../packages/orpc/src/index.ts)、[SDK](../../packages/sdk/package.json)、[Webhook設定](../../apps/server/src/workspaces/webhook-endpoint-service.ts)、[イベントノード](../../packages/core/src/automations/schema.ts)、[MCPテスト](../../apps/server/test/mcp.test.ts)。外部APIに到達する入口があっても、差分同期・媒体固有の認証・マッピングが製品として提供されることにはならない。

### E16

**AIは用途別の実装。** [Agent route map](../../apps/agent/src/app.ts)、[施策Agent](../../apps/agent/src/agents/marketing-automation-designer.ts)、[構造化提案](../../apps/agent/src/agents/structured-proposal.ts)、[LP生成に渡すブランド文脈](../../apps/server/src/web/landing-design-service.ts#L131)、[会社調査サービス](../../apps/server/src/contacts/company-enrichment-service.ts)、[補完結果型](../../packages/core/src/contacts/company-enrichment.ts)、[補完UI controller](../../apps/client/src/features/companies/enrichment-controller.ts)。`onApply`は`name`/`domain`だけを受け取る。調査提案の項目数を、そのままCRMへの保存能力と数えない。既存の[補完テスト](../../apps/server/src/contacts/company-enrichment-service.test.ts)・[UIテスト](../../apps/client/src/features/companies/company-enrichment-sheet.dom.test.tsx)も確認した。

### E17

**承認。** [状態遷移とactor判定](../../packages/core/src/projects/workflow.ts)、[承認サービス](../../apps/server/src/projects/project-brief-service.ts)、[ブリーフUI](../../apps/client/src/features/projects/project-brief-detail-view.tsx)、[security test](../../apps/server/test/project-brief-security.test.ts)。Project Briefの承認はあるが、すべての資産やすべてのProjectが常に承認必須という意味ではない。

### E18

**認可と監査。** [固定5ロール](../../packages/core/src/shared/schema.ts#L28)、[Workspaceアクセス](../../apps/server/src/auth/access.ts)、[操作別のrole判定例](../../apps/server/src/contacts/resource-router.ts)、[監査保存](../../packages/database/src/platform/audit-repository.ts)、[運用API](../../packages/orpc/src/operations/contract.ts#L63)、[設定UI](../../apps/client/src/features/settings/settings-page.tsx)。運用状態・DLQ参照はあるが、監査検索UIや項目権限の代替ではない。

### E19

**ブランド。** [ブランド型](../../packages/core/src/messaging/brand.ts)、[設定UI](../../apps/client/src/features/settings/brand-panel.tsx)、[LP生成側での利用](../../apps/server/src/web/landing-design-service.ts#L131)。型名はEmailBrandProfileだがLPにも利用されるので、メール除外を理由にこの共通文脈を無視しない。Workspace分離と、同一顧客基盤の複数ブランドは区別する。

### E20

**未実装の検索境界。** `apps/server/src`、`packages/core/src`、`packages/database/src`、`packages/orpc/src`、`apps/client/src/features`およびAgentのroute mapを対象に、型/テーブル、API、UI、実行ハンドラーを照合した。`customFieldDefinitions`、`merge`/`dedup`、`score decay`、`custom object`、`calculated properties`、広告媒体・Search Console・Salesforce・Zoom・WhatsApp・live chat等を検索し、関連するドメインの公開契約と実装を読んだ。テストfixture、ドキュメント、Agent用Skill内の用語は実装として数えていない。[READMEの現在の制約](../../README.md#現在の制約)と旧比較資料は補助資料に限った。

## 6. 検証と限界

### 今回実行した検証

以下を既存のWorkers Vitest構成で実行し、**17ファイル・79テストすべて成功**した。実行時間は36.59秒。設定は[vitest.config.ts](../../apps/server/vitest.config.ts)・[wrangler.test.jsonc](../../apps/server/wrangler.test.jsonc)。テスト用D1にmigrationを適用する構成であり、既存開発DBやリモートDBへmigrationを実行していない。

```bash
pnpm --filter @openengage/server exec vitest run \
  test/marketing-journey.test.ts test/marketo-journey.test.ts \
  test/visitor-identity.test.ts test/form-handlers.test.ts \
  test/form-custom-fields.test.ts test/rich-segments.test.ts \
  test/scoring-rules.test.ts test/scoring-events.test.ts \
  test/sales-handoff.test.ts test/roi-lifecycle-report.test.ts \
  test/campaign-attribution.test.ts test/landing-optimization.test.ts \
  test/landing-personalization.test.ts test/program-members.test.ts \
  test/project-brief-security.test.ts \
  test/automation-execution-control.test.ts \
  test/automation-callable-control.test.ts
```

[marketing-journey.test.ts](../../apps/server/test/marketing-journey.test.ts#L26)は匿名LPからフォーム、スコア条件、営業引き渡し、受注、ROI・LifecycleまでをAPI/Worker経由で検証する。ただし、Queueはテスト用stubを使う箇所があり、ブラウザの実クリックや本番の配送基盤を含む完全なE2Eではない。

文書については、リンク先のローカルファイル存在、参照定義、引用した行番号の範囲を確認した。MarkdownはOxfmtで整形し、整形チェックも実施した。コード・設定を変更しない調査のため、全アプリのbuild・全テスト・本番デプロイは行っていない。

### 未確認・解釈上の限界

- **実画面での操作感**：今回はUIコードと関連テストを読んだ。ブラウザで全画面を操作した検証ではない。今回実行していないテストを成功として計上していない。
- **外部接続**：HubSpotの契約済みポータル、Cloudflareの実リソース、AIプロバイダー、広告/SNSアカウントを使った動作検証はしていない。AIの品質・応答時間・継続費用も未評価。
- **大規模運用**：大量イベント・Contactに対する性能、R2へ退避したイベントを含む長期再集計、本番の処理上限は未確認。型や少量テストからHubSpotと同規模と推定しない。
- **監査の網羅性**：監査保存処理の存在は確認したが、すべての操作が漏れなく記録されるかの監査は行っていない。
- **HubSpotの提供差**：現在の公式資料を優先し、古いAcademy資料のMarketing Hub表記をページA/Bの現行契約条件に流用していない。ベータは一般提供済みと扱わない。Brand identityはカタログとKBでベータ表示が異なるため、カタログの注意を残した。
- **地域条件**：SMSの公式カタログと個別KBには米国/カナダ等の記述差があるため、北米番号・利用地域に制約があるという比較に留める。日本向けにそのまま利用できるとは扱わない。
- **提供機能の保証**：この資料は現コミットの調査結果。旧Pardot/Marketo比較時点の未実装判定や古いファイル位置をそのまま転記していない。

## 7. HubSpot公式出典

各表のリンクが該当主張の出典。以下は調査範囲を再確認するための一覧で、すべて2026-09-09に確認した。価格の比較や広告の購入は行っていない。

- 製品・プラン：[Product & Services Catalog][h-catalog]
- データ：[プロパティ][h-properties]、[一致による重複防止][h-dedup]、[重複候補管理][h-duplicates]、[セグメント][h-segments]、[計算項目][h-calculation]、[Custom Objects][h-objects]、[ABM][h-abm]
- 獲得：[フォーム][h-forms]、[CTA][h-cta]、[CTA A/B（ベータ）][h-cta-ab]、[CTA Smart Content][h-cta-smart]、[基本ページ作成][h-page-create]、[ページA/B][h-page-ab]、[ページSmart Contentの製品別表][h-smart]
- 自動化・分析：[Workflows][h-workflows]、[Lead scoring][h-scoring]、[Lifecycle][h-lifecycle]、[Custom events][h-events]、[Web分析][h-traffic]、[Cookie同意][h-cookie]、[Report builder][h-report-builder]、[Attribution][h-attribution]、[Journey][h-journey]
- 施策：[Campaigns][h-campaigns]、[施策詳細][h-campaign-detail]、[予算][h-budget]
- 連携：[Google Ads][h-ads]、[広告成果返送][h-ad-conversion]、[SNS][h-social]、[GSC][h-gsc]、[SEO][h-seo]、[Zoom][h-zoom]、[Live chat][h-chat]、[SMS][h-sms]、[WhatsApp][h-whatsapp]
- AI・業務管理：[Enrichment][h-enrichment]、[Brand context][h-brand-context]、[AEO（ベータ）][h-aeo]、[Agent Hub（ベータ）][h-agent-hub]、[Teams][h-teams]、[Audit][h-audit]、[Brands][h-brands]

[h-catalog]: https://legal.hubspot.com/hubspot-product-and-services-catalog
[h-properties]: https://knowledge.hubspot.com/properties/create-and-edit-properties
[h-dedup]: https://knowledge.hubspot.com/records/deduplication-of-records
[h-duplicates]: https://knowledge.hubspot.com/records/manage-duplicate-records
[h-segments]: https://knowledge.hubspot.com/segments/create-active-or-static-lists
[h-calculation]: https://knowledge.hubspot.com/properties/create-calculation-properties
[h-objects]: https://knowledge.hubspot.com/object-settings/create-custom-objects
[h-abm]: https://knowledge.hubspot.com/branding/get-started-with-account-based-marketing-in-hubspot
[h-forms]: https://knowledge.hubspot.com/forms/create-and-edit-forms
[h-cta]: https://knowledge.hubspot.com/ctas/create-calls-to-action
[h-cta-ab]: https://knowledge.hubspot.com/ctas/ab-test-your-calls-to-actions
[h-cta-smart]: https://knowledge.hubspot.com/ctas/add-smart-content-to-your-ctas
[h-page-create]: https://knowledge.hubspot.com/website-and-landing-pages/create-and-customize-pages
[h-page-ab]: https://knowledge.hubspot.com/website-pages/run-an-a-b-test-on-your-page
[h-smart]: https://knowledge.hubspot.com/website-pages/create-and-manage-smart-content-rules
[h-workflows]: https://knowledge.hubspot.com/workflows/create-workflows
[h-scoring]: https://knowledge.hubspot.com/scoring/understand-the-lead-scoring-tool
[h-lifecycle]: https://knowledge.hubspot.com/records/use-lifecycle-stages
[h-events]: https://knowledge.hubspot.com/reports/create-custom-events
[h-traffic]: https://knowledge.hubspot.com/reports/analyze-your-site-traffic-with-the-traffic-analytics-tool
[h-cookie]: https://knowledge.hubspot.com/privacy-and-consent/set-up-a-consent-banner-with-the-new-editor
[h-report-builder]: https://knowledge.hubspot.com/reports/create-reports-with-the-custom-report-builder
[h-attribution]: https://knowledge.hubspot.com/reports/create-attribution-reports
[h-journey]: https://knowledge.hubspot.com/reports/create-a-journey-report
[h-campaigns]: https://knowledge.hubspot.com/campaigns/create-campaigns
[h-campaign-detail]: https://knowledge.hubspot.com/campaigns/campaign-details-page
[h-budget]: https://knowledge.hubspot.com/campaigns/manage-your-campaign-budget
[h-ads]: https://knowledge.hubspot.com/ads/connect-your-google-ads-account-to-hubspot
[h-ad-conversion]: https://knowledge.hubspot.com/ads/create-and-sync-ad-conversion-events-with-your-google-ads-account
[h-social]: https://knowledge.hubspot.com/social/create-and-publish-social-posts
[h-gsc]: https://knowledge.hubspot.com/integrations/enable-the-google-search-console-integration-for-your-content-strategy-tool
[h-seo]: https://knowledge.hubspot.com/seo/view-seo-recommendations-in-hubspot
[h-zoom]: https://knowledge.hubspot.com/integrations/use-hubspot-and-zoom-webinars
[h-chat]: https://knowledge.hubspot.com/chatflows/create-a-live-chat
[h-sms]: https://knowledge.hubspot.com/sms/create-and-send-sms-messages
[h-whatsapp]: https://knowledge.hubspot.com/inbox/connect-whatsapp-to-the-conversations-inbox
[h-enrichment]: https://knowledge.hubspot.com/records/enrich-your-contact-and-company-data
[h-brand-context]: https://knowledge.hubspot.com/branding/generate-your-brand-identity-context-with-ai
[h-aeo]: https://knowledge.hubspot.com/seo/set-up-and-analyze-ai-visibility
[h-agent-hub]: https://knowledge.hubspot.com/ai/understand-agent-hub
[h-teams]: https://knowledge.hubspot.com/user-management/create-and-manage-teams
[h-audit]: https://knowledge.hubspot.com/account-management/view-and-export-account-activity-history
[h-brands]: https://knowledge.hubspot.com/branding/manage-your-brands-with-hubspot-brands
