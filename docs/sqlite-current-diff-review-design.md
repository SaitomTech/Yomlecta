# 現在のdiffレビュー5件の修正設計

作成日: 2026-09-20
状態: 主要項目を実装済み。残る旧commandのrequest型統一は別課題。

追補: 直近の4件（Rust更新重複、Appの保存責務、assetハッシュ計算、serviceテスト）は [責務レビューの詳細設計](sqlite-responsibility-review-design.md) を参照する。同文書は現在のコードに基づく差分と優先関係を記載している。特に `insert_project_indexes` は現在本番の初期取り込みでも使用しており、削除にはその経路の置換が必要。

本書の番号は直近のレビュー（記事保存、退避復旧、UIの保存責務、一覧取得、テスト専用保存実装）に対応する。
既存の `sqlite-review-remediation-design.md` は以前の指摘番号を使っているため、番号を対応させない。
共通の保存原則は同文書を引き継ぎ、今回の5件については本書を実装・検証の基準とする。
特に、以前は対象外だったテスト専用保存実装の置換を今回の対象に含める。

## 共通方針

- 操作成功時のDTOと再読込後のDTOが一致する。workspaceの一時状態は比較対象から除く。
- 一つの保存操作に必要なDB更新は一つのtransactionに含める。
- TSの純粋関数が変更後の内容を計算し、Rustが所属・revision・入力を検証して永続化する。
- DB保存成功後だけrevisionと画面stateを反映する。export生成の失敗で保存を巻き戻さない。
- 既存のテーブルを使う。汎用patch API、repository trait、DIコンテナ、job基盤は追加しない。

| 配置                          | 責務                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `App.tsx`                     | 画面の組み立て、画面遷移、callback接続                   |
| `useProjectWorkspace.ts`      | 現在のstate/ref、既存queue、操作成功時の画面反映         |
| `articleOperations.ts`        | 記事操作の純粋関数呼出し、workspace同期、保存request構築 |
| `projectOperations.ts`        | 取り込み・作成・削除などproject操作の調整                |
| `projectStorage.ts`           | 型付きcommand呼出し、revisionの取得・反映、初期化        |
| `projectAssetTransactions.ts` | ファイル退避・復元・回収。DB参照の有無だけを照会         |
| Rust command                  | Tauriの引数・Stateとserviceの接続                        |
| Rust service                  | 操作の検証、transaction、結果返却                        |
| Rust repository               | 共用するSQLと一覧の読取。transactionを勝手にcommitしない |

commandとservice本体は同じファイルに置いてよい。SQLを一行ごとに別関数へ分けず、共有する検証・記事metadata更新・document更新などを抽出する。

## 1. 記事編集の保存内容と画面を一致させる

### 原因

`handleSaveArticle` はルートのworkspaceを更新した後、同期前の `articles[]` から保存対象を取っている。
また、本文保存とタイトル保存は `documents.article_json` を更新しない。
その結果、タイトル・workflow・更新時刻の一部が保存から漏れる。

### 操作と保存契約

`articleOperations.ts` に本文一括編集とタイトル変更の入口を置く。どちらも次の順序に統一する。

1. 最新のprojectを既存queue内で取得する。
2. 既存の純粋更新関数を呼ぶ。戻り値が同じprojectなら保存しない。
3. `syncActiveArticle(next)` を呼び、同期済みarticleから保存項目を構築する。
4. 専用commandを一回呼ぶ。
5. 成功したrevisionを反映し、同期済みprojectを返す。

| 操作         | requestの変更内容                                       | 同時に更新するDB行                                             |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| 本文一括編集 | title、変更のあるslideのtranscript、workflow、updatedAt | articles、documentsのtitle、変更slide、projectsのupdatedAt     |
| タイトル変更 | title、updatedAt                                        | articles.title、documentsのtitle、articles/projectsのupdatedAt |

本文保存は既存 `db_update_article_content` を変更する。タイトル保存は `db_update_article_title` を設ける。
タイトル変更を汎用metadata保存へ流さない。タイトルだけの変更でworkflowや本文を書き戻さない。

requestはproject/article IDと操作固有の項目を持つ型付きstructにする。Article全体を渡さず、sourceRange・crop・settingsを編集保存時に更新しない。
transcriptは純粋関数が計算した変更後の値を渡す。変更していないslideはrequestから除外する。

### 原稿タイトルの更新

共用のtransaction内関数で `documents.article_json` のtitleだけを置換する。
既存のsummary・sections・生成metadataを保持する。article_jsonがNULLの場合は `{ title }` を作成し、現行の `updateProjectArticleTitle` / `updateProjectArticleDraft` と一致させる。
`articles.title` と同じ正規化済みtitleを保存し、両者を一方だけ変更できる経路を残さない。

article/documentと変更slideのexpected revisionを必須にする。いずれかが競合したら全rollback。
projectはtitleやactiveArticleIdを上書きせずupdatedAtだけを更新し、採番したproject revisionも返す。
返却値には変更したarticle/document/slide/projectのrevisionを含める。
本文保存はworkflowも同時更新する。タイトル変更はworkflowを変更しない。

### 検証

- 本文とタイトルを同時変更→別記事へ切替→再読込で、本文・両タイトル・workflow・updatedAtが一致する。
- タイトルだけの変更でsummary・sections・本文が保持される。
- documentがNULLの状態からタイトルを保存できる。
- documentまたは最後のslideで競合した場合、先に更新した行もrollbackされる。
- 無変更保存ではcommandを呼ばず、revisionも増えない。

## 2. 復旧失敗時に退避ファイルを残す

### 修正箇所と境界

`beginAssetTrashTransaction` のcatch内にある無条件のfinally cleanupを廃止する。
`restoreAssetTrashTransaction` は、元パスが既に存在する場合に退避パスを削除しない。
復元できたこととDB削除が確定したことを、回収の根拠として明示する。

復元関数は最低限 `restored | already-restored | preserved` を返す。I/Oエラーは例外とする。
`preserved` は元・退避の両方あり、または両方なし等の自動判断できない状態。
`already-restored` は元あり・退避なしを確認できた場合だけとする。
呼出し元はrestored/already-restoredの後にだけ空のjournalを回収する。

| 状態                              | 動作                               |
| --------------------------------- | ---------------------------------- |
| DB参照あり・元なし・退避あり      | renameで復元。成功後にjournal回収  |
| DB参照あり・元あり・退避なし      | 復元済みとしてjournal回収          |
| DB参照あり・元あり・退避あり      | 両方保持して警告                   |
| DB参照あり・元なし・退避なし      | 欠落を報告。復元成功にしない       |
| DB参照なし                        | 退避領域のみ回収。元パスは触らない |
| DB照会失敗・journal不正・復元失敗 | ファイルとjournalを保持            |

退避準備の途中失敗はDB削除前なので、DB削除済みと扱わず復元だけを試みる。
rename済みかどうかは実パスも確認する。movedフラグだけでデータ不在と判定しない。
最初のjournal書込み前に失敗した場合、空であることを確認できない領域はそのまま残す。

project全体の削除とarticle/video削除、起動時復旧に同じ判定を適用する。
通常削除は「初期化待ち→退避→DB削除→回収」。DB削除後のloadProjectはDB rollback用catchから外す。
DB削除成功後の回収失敗は削除成功＋警告とし、journalを残して起動時に再試行する。
DB応答が不明なときは参照確認を行い、確認できるまで破棄しない。

### 検証

ファイル操作と参照照会をmockして、移動後のjournal書込み失敗＋復元失敗を再現する。
元動画・退避動画・journalに対して、許可した回収以外のremoveが呼ばれないことを検証する。
復旧を2回実行してもファイルを失わず、正常な復元後はjournalが残り続けないことも確認する。
テスト用の差し替えは既存I/Oモジュール境界で行い、本番に汎用ファイルtransaction基盤を追加しない。

## 3. UIから保存順序とtransaction制御を取り除く

### 操作単位への変更

現在の「結果commit→persistActiveArticle」を、一つの操作commandに置換する。
各commandのrequestには対象ID、結果、必要な変更後workflow/settings、updatedAt、expected revisionsを含める。

| 操作             | 同一transactionの範囲                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| スライド検出完了 | 新run・slides・画像asset参照・採用run・検出settings・workflow・更新時刻 |
| 文字起こし完了   | 新run・採用run・各slideへの発話割当・workflow・更新時刻                 |
| OCR完了          | 新OCR/run・採用結果・対象slideのtranscript無効化・workflow・更新時刻    |
| 本文生成完了     | 新run・対象slideのtranscript・workflow・更新時刻                        |
| スライド手動編集 | transcript・対象OCRの補正・workflow・更新時刻                           |

要約・章構成とCropの既存一括commandも同じ契約に揃える。後段のmetadata保存は廃止する。
画像生成・動画コピー・exportはDB transactionの外に置く。
旧画像を上書きする現行仕様では、DB rollbackは画像内容まで保証しない。この制約は別件として明示する。

### 状態とrevision

今回の最小構成では記事内の結果変更・workflow変更でarticle revisionを増やす。
queue内で最新DTOからrequestを作り、expected article revisionと変更対象のdocument/slide/OCR revisionを検証する。
OCRのrevisionはslide IDだけでなく採用OCR結果IDと組にして管理し、異なる結果のrevision 0を混同しない。
入力の変更がないという純粋関数の判定は操作入口でno-opにする。

非同期処理では開始時のproject/article/slide IDと入力の照合値を保持する。
完了時はその対象が現在も存在し入力が一致することを確認し、最新状態から更新内容を計算する。
別記事がactiveになったという理由で保存先を変更しない。
開始時のarticle revisionだけでバッチ全体を固定せず、直前の同一バッチ保存結果を含む最新DTOを使う。
開始時の本文・OCR等から導いた結果を保存する場合は、その依存入力の変更も照合して拒否する。
DBでの競合は自動再試行せず、再読込と再計算を必要とする。古いrequestに新しいrevisionだけを付けない。

queueは現在のAppの一つをhookへ移す。storageの削除専用queueを統合し、全ユーザー操作を同じ入口に通す。
hookは操作関数の返す確定済みprojectを画面へ反映する。Appは保存commandを直接importしない。
hookを汎用state管理ライブラリへ拡張せず、既存のref/state/queueを移動する範囲にとどめる。

### 検証

- 結果INSERT後のworkflow更新を失敗させ、結果・採用行・revisionもrollbackされる。
- 各操作のTS側で保存commandが一回だけ呼ばれる。
- 保存失敗ではstate/revisionを変更しない。成功では再読込と一致する。
- 同じバッチの複数slideを連続保存できる。記事切替後に別記事へ保存されない。
- Appから複数DB command呼出しとファイル補償コードがなくなる。

## 4. 一覧取得を専用の読取モデルに分離する

### APIとデータ量

`db_list_projects` はproject全体ではなく一覧用のprojectionを返す。
`db_load_project` は詳細の復元専用のまま維持する。
新しいsummaryテーブルや更新時の集計キャッシュは作らない。最初は既存テーブルから都度集計する。

Rustの一覧queryは以下を取得する。projectごとにload関数を呼ばず、CTEと集計で固定本数のqueryにする。
複数queryに分ける場合は同一read transactionでsnapshotを揃える。

- projectのID・version・title・時刻。
- 最初のvideo（created_at, id順）の表示用media項目と、video/article件数。
- activeArticleIdの記事。未指定なら最初の記事（created_at, id順）。不正な参照IDはinvalid。
- 対象articleのworkflow、crop有無、採用slide detectionの有無。
- 採用slide集合の件数、画像のない件数、OCR完了数、本文完了数、発話あり件数。
- 対象articleの参照video thumbnail、なければposition順で最初の代表画像。

OCR完了判定は採用OCRのedited_textがあればそれを使い、なければraw_textを使う。
本文完了判定はarticleBody、対象数はraw発話を使う。空白のみを未完了とする既存TSのtrim判定と揃える。
SQLiteのtrimだけではJSと空白文字の扱いが異なるので、実装時に対象文字を明示して日本語全角空白・改行も含めたfixtureで一致を確認する。
全transcript/全文OCR/summary/sections/解析result JSONをIPCへ返さない。

### TS側の責務

projectionから `ProjectSummary` を作る純粋関数を `projectProgress.ts` に置く。
resumeStepの優先順位など画面向けルールはここに一元化する。
既存 `buildProjectSummary` が他で必要なら同じ関数へ必要情報を渡す。呼出し元がなくなるなら削除する。
既存のsourcePath存在確認は維持し、失敗をprojectごとに扱う。今回healthの意味を拡張しない。
最終ソートは現行どおりlastOpenedAt降順。

### 部分破損とエラー

戻り値はproject単位の `summary data | invalid { id, error }` とする。
一覧に必要なmetadataが不正なら、そのprojectだけinvalidに変換する。
JSON参照はjson_validと期待する型を確認した上で評価し、壊れたJSON一件でSQL全体を失敗させない。
DB接続・SQL実行自体の失敗は全体エラーとして返し、空一覧へ変換しない。

一覧は詳細データの完全な整合性検査ではない。原稿等の一覧未使用データだけの破損は詳細を開く際に報告する。
この境界により正常なprojectへのアクセスを確保し、一覧のたびに全文検証しない。

### 検証

- 空project、複数動画/記事、active未指定、crop待ち、画像不足、OCR編集済み、本文あり等で従来summaryと一致する。
- 一件の一覧metadata破損で正常なprojectが消えない。詳細のみの破損では一覧表示できる。
- 大量slideと長いOCR/本文のfixtureでもresponseに全文が含まれず、query回数がslide/project件数に比例しない。
- 一覧取得から `load_project_from_indexes` が呼ばれない。

## 5. 本番serviceを使うテストへ置換する

### 必要最小限の分離

既存の `#[tauri::command]` 関数を薄いwrapperにし、同一モジュールに本体を置く。

```rust
#[tauri::command]
pub async fn db_update_article_content(
    state: State<'_, DbState>,
    request: UpdateArticleContentRequest,
) -> Result<UpdateArticleContentResult, String> {
    update_article_content(&state, request).await
}

pub(crate) async fn update_article_content(
    state: &DbState,
    request: UpdateArticleContentRequest,
) -> Result<UpdateArticleContentResult, String> {
    // 検証、transaction、SQL、revision返却の本番処理
}
```

TSのinvoke引数も `{ request }` へ同時に切り替える。旧引数の互換commandは追加しない。
変更するcommandから順に型付きrequest/resultを導入し、既存JSONドメイン全体のRust型化は行わない。

テストはmigration済みin-memory SQLiteと一時assetディレクトリで `DbState` を生成する。
fixtureは入力DTOとダミーファイルを用意し、create project/video/article、解析commitの本番serviceを順に呼ぶ。
既存 `insert_project_indexes` とテスト専用 `insert_asset` を削除する。
asset rootを省略して検査をスキップする経路がテストだけに必要なら、それも削除する。

### テストの役割

- Rust: 本番serviceで保存→本番loaderで再読込し、変更・保持・削除対象を検証する。
- Rust: stale revisionのservice呼出しを拒否し、全対象行が不変なことを確認する。
- Rust: テストDB限定の制約/triggerで後続SQLを失敗させ、transaction全体のrollbackを検証する。
- TS: 純粋関数の結果からrequestが正しく作られ、成功時だけ同期済みstateを返すことを検証する。
- TS: I/O mockで退避復旧の失敗系を検証する。

SQLの `WHERE revision = ...` だけを直接実行する既存テストは、本番serviceの競合テストに置換する。
破損状態を作るテストの直接SQLは許容するが、正常系の保存を別SQL実装で代替しない。
テスト用fault injection分岐を本番serviceに追加しない。

## 実装順と完了条件

1. 指摘2の破壊的cleanupを除去し、失敗系テストを追加する。
2. 指摘5のservice抽出とfixtureを、指摘1で使う経路から実施する。
3. 指摘1の本文・タイトル保存を修正し、再読込一致を保証する。
4. 指摘3の解析保存を操作ごとに一括化し、hookへqueue/stateを移す。
5. 指摘4の一覧projectionを追加し、旧全文読込経路を削除する。
6. 残るテスト専用保存関数、未使用command/import、重複queueを削除する。

各commandは呼出し元と同じ変更単位で切り替える。旧保存と新保存を両方呼ぶ中間状態を作らない。
既存テストに加え、上記回帰テスト・型検査・Rustテスト・lint/buildを実行する。
React変更後にはReact Doctor、最後に `git diff --check` を実行する。
実機では取り込みから編集・再読込・削除まで確認する。自動テストだけでファイル/DB/画面の一連の成功を断定しない。

この修正のためのスキーマ変更は予定しない。解析履歴切替、汎用イベント基盤、自動リトライ、summaryキャッシュ、paginationは今回導入しない。
将来の拡張点は具体的な操作request/serviceと一覧projectionに限定し、今は呼出し元のないAPIを作らない。
