# SQLite差分レビュー4件の詳細設計

作成日: 2026-09-20
状態: 主要項目を実装・検証済み。全commandのrequest型統一は別課題。

## 対象と既存設計との関係

直近レビューの「Rust更新処理の重複」「Appの保存責務」「asset SHA-256の過剰実装」「本番commandのテスト不足」に対応する。
[現在のdiffレビュー設計](sqlite-current-diff-review-design.md)の責務分離・本番serviceテストを具体化し、今回の4件については本書を優先する。
[以前の修正設計](sqlite-review-remediation-design.md)のファイル復旧・非同期処理の対象固定等は引き続き別の要件として有効。今回の完了を、以前の全指摘の解消とは扱わない。

現コードとの差異を次のとおり整理する。

- 現在の解析保存は既に結果とmetadataを一つのcommandで保存している。「結果commit後にmetadataを再保存する」という旧設計の原因説明は現コードには当てはまらない。
- `insert_project_indexes` はテストだけでなく `db_create_project_bundle` でも使用している。本番経路を置換してから削除する。
- 本文保存は現在documentも更新する。今回は保存漏れの再修正ではなく、保存範囲と共有処理の整理を行う。
- assetのSHA-256計算を廃止する。モデルダウンロードの期待ハッシュ照合と `sha256_app_local_file` は別用途なので維持する。

## 共通の設計判断

| 層                                            | 最終的な責務                                           |
| --------------------------------------------- | ------------------------------------------------------ |
| `src/app/App.tsx`                             | 画面構成、画面遷移、操作callbackの接続                 |
| `src/app/useProjectWorkspace.ts`（追加）      | projectのstate/ref、既存の操作queue、成功後のstate反映 |
| `src/lib/project/articleOperations.ts`        | 記事の状態変換、同期、操作固有の保存内容の選択         |
| `src/lib/project/projectOperations.ts`        | project作成・読み込み・改名・取り込み・削除の調整      |
| `src/lib/storage/projectStorage.ts`           | 初期化、型付きIPC、revisionの取得と成功後の反映        |
| `src/lib/storage/projectAssetTransactions.ts` | ファイルの退避・復元・回収                             |
| Rust command                                  | Tauri引数・Stateをserviceへ渡す                        |
| Rust service                                  | 操作の検証、transactionの開始とcommit、操作結果の返却  |
| Rust repository                               | 複数操作で共有するSQL。transactionの所有権は持たない   |

状態変換のルールは既存の `project.ts` を使う。Rustへ同じ無効化ルールを再実装しない。
拡張は具体的な操作関数/requestを追加する形にする。汎用patch command、repository trait、DIコンテナ、イベント基盤、履歴切替機能は導入しない。

## 1. Rust更新処理と検証の集約

### 1.1 修正する問題

`services/mod.rs`、`projects.rs`、`documents.rs` にarticle/project更新SQLとrevision照合が重複している。
特に `db_update_document_and_article` はactive articleの所属確認がなく、他projectの記事IDを保存できる。
さらに、要約保存等がsourceRange/crop/settingsまで書き戻すため、操作の責務が必要以上に広い。

共有するのは「何でも更新する関数」ではなく、所属確認・revision確認・workflow更新・project更新時刻・documentタイトル同期など、意味の同じ処理に限定する。

### 1.2 commandとserviceの境界

各serviceファイル内に型付きrequest/resultとState非依存の本体を置く。新しいcommand専用ディレクトリは作らない。

```rust
#[tauri::command]
pub async fn db_update_document_and_article(
    state: State<'_, DbState>,
    request: UpdateDocumentAndArticleRequest,
) -> Result<DocumentMutationResult, String> {
    update_document_and_article(&state, request).await
}

pub(crate) async fn update_document_and_article(
    state: &DbState,
    request: UpdateDocumentAndArticleRequest,
) -> Result<DocumentMutationResult, String> {
    // 検証 → begin → 所属/revision確認 → 操作固有SQL → commit → result
}
```

request/resultはserdeのcamelCaseに統一し、TSは `invokeDb(command, { request })` で呼ぶ。requestは未知フィールドを拒否する。
ID・revision・時刻・種別は型を持たせる。transcript等の既存JSON payloadは必要な形を境界で検証し、全ドメインのRust型化は行わない。
エラーは既存の `CODE: message` を維持し、今回独立したエラー基盤は作らない。

### 1.3 更新範囲

全記事操作は `projectId` と `articleId` を持つ。article全体とarticleIdの二重指定を廃止する。
次表の「共通」はarticlesのupdatedAt/revision、projectsのupdatedAt/revisionを指す。

| 操作・command                                            | 操作固有の保存範囲                                                  | 必須expected revision                     |
| -------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| `db_update_project`                                      | project title、activeArticleId、updatedAt                           | project                                   |
| `db_update_article_title`（追加）                        | articles.title、documentのtitle、共通                               | article、document                         |
| `db_update_article_workflow`（旧metadata commandを置換） | workflow、明示されたactiveArticleId、共通                           | project、article                          |
| `db_update_article_content`                              | 変更slideのtranscript、両title、workflow、共通                      | article、document、変更slide              |
| `db_update_document_and_article`                         | documentのsummaryまたはsections、両title、workflow、必要なrun、共通 | article、document                         |
| `db_update_article_source`                               | 入力変更、既存仕様の出力初期化、workflow、共通                      | article、document                         |
| 検出・文字起こし・OCR・本文生成・slide編集               | 現在の操作固有結果、必要なsettings/workflow、共通                   | articleおよび現commandが更新するslide/OCR |

記事の保存commandからproject titleとactiveArticleIdを除く。projectの更新時刻を進めるだけの操作ではexpected project revisionを要求せず、DBの現在値からrevisionを加算する。別記事の保存でproject全体を不要に競合させない。
activeArticleIdを変更できるのはproject更新とworkflow更新。どちらも同一の所属検証を必ず呼ぶ。空projectではnullを許可する。
workflow更新ではactiveArticleIdを必須nullableフィールドとし、queue内の最新stateから現在値または開く記事IDを渡す。省略による暗黙の保持/削除を設けない。
削除commandのactive article再選択は、同じprojectを条件とした既存SQLを維持する。

要約・章構成のrequestは `change` を判別可能なenumにする。

```text
UpdateDocumentAndArticleRequest
  projectId, articleId, updatedAt
  title, workflow
  expectedArticleRevision, expectedDocumentRevision
  change:
    { kind: "summary", summary, runId }
    | { kind: "sections", sections: ArticleSections | null, runId: string | null }
```

Rustはsummary操作ではsummary_generation、sections操作ではchapter_generationのみ登録する。任意のrunKindは受け付けない。
summaryの現行生成run方針は維持する。sectionsがnullまたはmodelがmanualならrunIdはnull、生成結果ならrunIdを必須とし、不整合な組を拒否する。
documentはDBの現値へtitleと変更対象項目だけを反映する。summary保存はsectionsを保持し、sections=nullはsectionsキーを削除する。未知の既存document項目も保持する。

### 1.4 共用する関数

`services/mod.rs` に操作横断の検証、`repositories.rs` に共用SQLを置く。単一操作しか使わないSQLはそのserviceに残す。

| 関数（設計名）                                                            | 契約                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `require_article_revision(tx, project_id, article_id, expected)`          | 所属込みでSELECTし、未存在はNOT_FOUND、revision不一致はREVISION_CONFLICT |
| `require_document_revision(tx, article_id, expected)`                     | document存在とrevisionを照合                                             |
| `validate_active_article(tx, project_id, active_id)`                      | nullまたは同projectの記事だけを許可                                      |
| `update_article_workflow(tx, article_id, expected, workflow, updated_at)` | workflow・時刻・revisionだけを更新                                       |
| `update_document_title(tx, article_id, expected, title)`                  | NULLならtitleだけのJSONを作成、既存ならtitleだけ更新                     |
| `touch_project(tx, project_id, updated_at)`                               | title/activeを変更せず時刻更新・revision加算し、新revisionを返す         |

複数項目を更新する操作では一つのUPDATEにまとめ、同じ行のrevisionは一操作につき一度だけ増やす。たとえば本文保存でtitle/workflowを同時更新する場合、上記workflow専用関数を追加で呼ばない。
汎用テーブル名・列名を引数にするSQL生成は作らない。revision比較そのものの純粋helperと、更新件数の確認helperは共有してよい。
すべての条件付きUPDATEでrows_affected=1を確認する。0件を成功扱いして架空のrevisionを返さない。

### 1.5 transactionと返却

1. requestの型・ID・必須項目を検証する。
2. transactionを開始し、対象の所属・expected revision・関連slide/OCRを検証する。
3. document/slide/run等の操作固有更新とarticle更新を実行する。
4. project時刻とrevisionを更新する。
5. commit成功後にだけresultを返す。途中失敗は全rollback。

返却は変更した行のIDとrevisionを持つ具体的なresult型とする。document操作ならproject/article/document、本文編集ならそれに変更slide一覧を加える。汎用entity配列にはしない。
TSでrevisionが不明な場合は保存前にエラーとし、0への補完やexpectedの省略をしない。競合時に古いrequestへ新しいrevisionを付けて自動再試行しない。
開始時の入力照合が必要な解析は、以前の設計の対象ID・入力照合を維持する。最新revisionを付けるだけでは古い解析結果を検出できない。

### 1.6 完了条件

他projectのactive article、記事と異なるslide、古いrevisionの保存を本番serviceで拒否できる。
要約保存等のrequest/SQLからsourceRange・crop・project title/activeの書き戻しがなくなる。
`update_article_metadata_in_transaction` と広いarticle全体更新commandは全呼出し元の移行後に削除する。

## 2. Appから記事保存の判断を移す

### 2.1 操作API

`articleOperations.ts` の既存5関数に、`saveArticleDraft`、`saveArticleTitle`、`saveArticleSummary`、`saveArticleSections`、`saveArticleSource`、`saveArticleWorkflow` を追加する。
各関数はprojectと明示的な対象articleId、および操作入力を受ける。project改名は `projectOperations.ts` の `renameProject` に置き、記事保存を経由しない。
open/load/create/delete/取り込みも同ファイルの具体的な操作入口をhookから呼ぶ。

記事操作の共通順序は次のとおり。

1. 対象project/articleの一致と存在を確認する。対象違いをno-opにしない。
2. 既存の純粋関数でnextを計算する。
3. 無変更なら入力と同じprojectを返し、DBを呼ばない。
4. `syncActiveArticle(next)` でworkspaceとarticles配列を同期する。
5. 操作固有の保存内容を選ぶ。本文編集では変更slideだけを抽出する。
6. storageを一回呼び、成功後に同期済みprojectを返す。

戻り値は `Promise<MediaProject>` に統一する。未存在は例外、無変更は同じ参照、変更成功は新しい参照とし、nullと未存在を混同しない。
純粋関数の利用にactive workspaceが必要なら、入口で対象一致を確認してから使う。画面切替後の古いcallbackを別記事へ付け替えない。
バックグラウンドで非active記事も更新する機能は今回追加せず、対象が変わった結果は明示的に拒否する。

### 2.2 hookとqueue

`useProjectWorkspace` にAppのproject state/refと `enqueueProjectOperation` を移す。hookは名前付き操作を返し、任意の更新関数を受け取る汎用persist APIをAppへ公開しない。
全更新とloadは一つのqueueを通し、各処理の実行開始時に最新projectを取得する。失敗した操作で次の操作が永久に止まらない現在のPromise連鎖を維持する。
空project作成も同じ入口に通す。storageの削除専用queueは呼出し元移行後に削除する。
初期化Promiseはstorageに残し、削除を含む公開操作は退避処理を始める前に初期化を待つ。

```text
App callback（呼出し時のprojectId/articleIdを保持）
  → hookの名前付き操作
    → queue内で最新projectと対象IDを照合
      → articleOperationsの純粋変換・保存
        → projectStorageのIPC・revision反映
    → 成功時だけref/state更新
  → 必要ならexport生成、画面遷移
```

長時間解析の対象IDは結果受領時ではなく開始時に保持する。hookへ移す際もその契約を弱めない。
画面遷移のrequest番号とrouteはAppに残す。保存と遷移を混ぜず、保存完了後も最新の遷移要求である場合だけrouteを更新する。
export生成は保存成功後に確定したprojectを使う。export失敗は保存成功を取り消さない。無変更なら不要な再生成を省略できる。

### 2.3 storageの整理

純粋関数・run種別判断・React stateをstorageへ移さない。
storageはrequestへ必須revisionとrun ID等の保存用識別子を補い、IPC成功後に返却revisionを反映する。
同じrevision反映が複数関数にある場合のみ共用helperを作る。Mapを汎用キャッシュ管理機構へ拡張しない。
読み込みではDTO解析成功後にrevision snapshotを採用する。削除・再検出の返却情報から不要になったrevisionを除去する。

### 2.4 完了条件

Appからstorageの保存command、`syncActiveArticle`、記事の純粋更新関数、runKind判断、ファイル補償処理への直接依存がなくなる。
記事操作が成功したときだけstateが変わり、無変更保存はIPCなし、失敗保存はstate/revision不変となる。
新しい保存操作を追加する際に、AppでDB更新項目を決める必要がない。

## 3. assetのハッシュ計算を廃止する

### 3.1 最小のファイル検査契約

`assets.rs` の `inspect_asset` をmetadataだけの検査へ変更する。

```rust
pub(crate) enum AssetFileState {
    Present { byte_size: i64 },
    Missing,
}

pub(crate) fn inspect_asset(
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<AssetFileState, String>;
```

asset rootをOptionにせず本番・テストの両方で実在するrootを渡す。
パス検証と既存の相対/絶対パス解決後に `fs::metadata` を一度呼ぶ。本文のopen/readはしない。
通常ファイルならサイズを返す。NotFoundならMissing。ディレクトリ等は不正asset、PermissionDenied等はI/Oエラーとして返し、欠落と混同しない。
u64からi64への変換はchecked conversionを使う。

### 3.2 DB登録と起動時確認

asset登録ではPresentをbyte_size・missing_at=NULL、Missingをbyte_size=0・missing_at=現在時刻として保存する。
同じパスを再確認して欠落が続く場合は既存missing_atを保持する。パスが変わった場合は新しいパスの状態として記録する。
欠落ファイルを登録できる現行仕様は維持し、今回インポート全体の修復仕様は変更しない。

起動時確認は各assetに同じ検査関数を適用する。

| 検査結果  | DB更新                                        |
| --------- | --------------------------------------------- |
| Present   | 最新byte_sizeへ更新、missing_atをNULLへ       |
| Missing   | byte_size=0、missing_atは既存値または現在時刻 |
| I/Oエラー | 当該assetを欠落扱いせずエラーを返す           |

起動時エラーが初期化失敗になる現行方針は維持する。部分復旧UIの追加は別課題。
変更のないbyte_size/missing_atはUPDATEしない。検査はファイル数に比例するが、ファイル容量には比例しない。
metadata検査は引き続き登録transaction内で行える。今回、非同期検査queueやバックグラウンドchecksum jobは追加しない。

### 3.3 スキーマと既存データ

`0001_initial.sql` は適用済みDBがあり得るため書き換えない。既存のnullable `assets.sha256` 列は廃止済みの列として残し、SELECT・比較・新規計算をやめる。
既存ハッシュは検証済みと解釈しない。assetをupsertする際はNULLにして古いパス・内容のハッシュを再利用しない。既存行を消去するためだけの起動時全件UPDATEは追加しない。
列削除だけのmigrationは今回作らない。将来、台帳スキーマを実際に変更する際に通常の追加migrationで整理できる。
この列を残す理由はmigrationの安定性であり、将来用ハッシュAPIを予約するためではない。

`sha2` 依存と `src/lib/models/download.ts` の期待ハッシュ照合は維持する。削除するのはDBモジュール内のSha256/BufReader/Readと8MiB bufferのみ。
`sqlite-detailed-design.md` のasset検査説明とテスト名を実装時に更新する。

### 3.4 完了条件

asset登録・起動時確認にファイル全体の読み込みがなく、実ファイルの欠落/復帰とサイズ変更が記録される。
既存migrationのchecksumが変わらず、sha256に値のあるDBでも起動できる。
モデルダウンロード時の検証経路は引き続き利用可能。

## 4. 本番serviceを呼ぶテストへ置き換える

### 4.1 本番経路の一本化

まず第1章の薄いwrapperを作り、同じservice本体をcommandとテストが呼ぶ。
create系・load系もテストfixtureで必要なものから `&DbState` で呼べる本体を抽出する。テスト専用の保存serviceは作らない。

`create_project_bundle` は重複するproject全体・video・articleを受け取る形をやめ、projectの基本metadataとvideo一件、初期article一件を受け取る。
同一transaction内でprojectをactive=NULLで作成→既存の `insert_video_row` → `insert_article_row` →同project検証済みarticleをactiveへ設定する。作成完了時のrevisionは従来どおり0とする。
初期articleは範囲・crop等の入力だけを受け取り、解析済みprojectの一括復元APIとしては使わない。
この本番経路とテストfixtureを切り替えた後、`insert_project_indexes` とそれだけが使う `insert_asset` を削除する。

### 4.2 fixture

各テストは独立したin-memory SQLite（max_connections=1、foreign_keys有効）と一時assetディレクトリを作る。
本番migrationを適用し、本番と同じ `DbState` を構築する。正常データの作成はcreate/解析serviceを順に呼ぶ。
固定IDと固定入力時刻を使い、生成run IDもfixture側で明示する。返却revisionを次のrequestへ渡す。
ファイルは小さなダミー動画・画像でよい。ffmpeg/OpenAI/モデルダウンロードはserviceの責務外なので実行しない。
cleanupはテスト終了時に行い、ファイルを使うテスト間でディレクトリを共有しない。

### 4.3 Rustの必須ケース

| ケース                                                | 検証する結果                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| project更新/workflow更新へ別projectの記事をactive指定 | VALIDATION_ERROR。title・active・workflow・revisionを変更しない                   |
| 要約・章構成保存                                      | 対象項目・両title・workflowだけが変わり、他項目・入力・project title/activeを保持 |
| titleだけの変更                                       | summary/sections/本文を保持、NULL documentにもtitleを保存                         |
| 本文一括編集                                          | 変更slideだけ更新。未変更slideの内容とrevisionを保持                              |
| article/document/slideの古いrevision                  | REVISION_CONFLICT。全対象行が不変                                                 |
| project更新の古いrevision、他projectの対象ID          | 保存拒否。0件UPDATEを成功と扱わない                                               |
| 解析保存→次slide保存                                  | 成功し、返却revisionとDBが一致。run/採用結果が対応する                            |
| 後段SQL失敗                                           | document/slide/run/選択行/article/projectを全rollback                             |
| bundle作成途中失敗                                    | project/video/article/document/assetが一部だけ残らない                            |
| asset確認                                             | present→missing→missing→presentでmissing_atを保持/解除しサイズも更新              |
| 既存sha256列に値があるDB                              | 新しい検査経路で起動時確認・再登録が成功                                          |

後段失敗はテストDBに `BEFORE UPDATE ON projects ... RAISE(ABORT, ...)` 等のtriggerを置いて起こす。
正常保存用SQLをテスト側に再実装せず、trigger作成・破損fixture・結果照会に限り直接SQLを使う。
失敗後の比較には更新内容だけでなくrevision・run件数・採用IDも含める。
DBだけでは復元できないworkspace一時項目を除き、本番loaderで再読込した内容を比較する。

### 4.4 TypeScriptの必須ケース

既存Bunテストに `article-operations.test.ts`、`project-storage.test.ts` を追加する。
I/O差し替えは既存storage/invokeモジュール境界で行い、テストのための汎用DIや本番の失敗注入フラグを追加しない。

- 各操作で純粋変換後の同期済みarticleからrequestを作る。summary/sectionsのrun方針も確認する。
- 無変更ならIPCを呼ばず同じ参照を返す。失敗ならnextを返さない。
- IPC成功のrevisionだけを反映する。失敗時は以前のrevisionを使い続け、不明revisionを0に補完しない。
- 本文編集のrequestに未変更slideやcrop等の対象外項目が含まれない。
- 本文保存→要約保存→章保存を再読込なしで連続実行できる。
- request/resultのcamelCase・nullable項目をfixtureで照合する。Rust側にも同じ代表的なJSON形状のserdeテストを置く。

hookの検証は既存のReactテスト環境がないため、最初は操作層の自動テストと実機確認で分担する。テストのためだけにqueue抽象や新しいブラウザ試験基盤を作らない。
実機では連続保存・保存失敗後の次操作・保存中の画面切替・export失敗後の再読込を確認し、state/routeと保存内容を照合する。

### 4.5 既存テストの扱い

`revision_condition_prevents_stale_update` は本番serviceでの競合テストへ置換する。
`normalized_indexes_round_trip_a_project` はcreate/解析serviceでfixtureを作るround-tripテストへ置換する。
`asset_metadata_tracks_size_and_sha256` はサイズ・欠落・復帰テストへ置換する。
既存16件の純粋なworkflowテストは維持する。前回の16件/3件成功は変更前の結果であり、本設計の検証成功を意味しない。

## 実装順と検証ゲート

1. command/service分離と本番fixtureを作る。まず現在の正常系を本番service経由で検証する。
2. 第1章の所属/revision検証と操作別requestを導入し、TS呼出し元を同じ変更単位で切り替える。検証漏れ・rollbackの回帰テストを通す。
3. bundle経路を既存row登録処理へ統合し、旧一括登録とテストの迂回経路を削除する。
4. 第2章の操作関数とhookへ責務を移し、削除専用queue・広いpersist関数を削除する。
5. 第3章のasset検査簡素化とテスト置換を行う。migrationとモデル照合の維持を確認する。
6. 既存設計書の現状説明を更新し、旧command/import/helperの参照が残っていないことを確認する。

操作を移す単位で型検査と関連テストを実行する。最終確認は `bun test`、`bunx tsc -b`、`cargo test --manifest-path src-tauri/Cargo.toml --lib`、lint/build、React Doctor、`git diff --check` と実機の取り込み→編集→再読込→削除。
lint等の既存の別件失敗は今回の変更による失敗と区別して記録する。

4件の完了は、重複による検証差が解消し、Appから保存判断が消え、asset本文読み込みがなく、本番serviceで成功・競合・rollbackが検証されること。
解析履歴、一覧projection、ファイル復旧の全ケース、完全な画像rollbackは本書だけでは完了扱いにしない。
