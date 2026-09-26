# Yomlecta SQLite永続化設計

設計・実装日: 2026-09-19

適用状況: [責務レビューの詳細設計](sqlite-responsibility-review-design.md) に記載した操作別API、asset台帳のSHA-256計算廃止、本番serviceテストへの移行の主要項目を適用した。全commandのrequest型統一は別課題として残す。

## 1. 方針

Yomlectaの正本をプロジェクトJSONからSQLiteへ移す。新規ユーザーだけを対象にするため、旧`project.json`や`project.summary.json`は読まない。旧形式を受け付ける互換層も作らない。

画面が保持する`MediaProject`は編集用DTOであり、正本ではない。画面の操作ごとに、対象テーブルだけをTauri command経由で更新する。

次の状態をSQLiteで独立して管理する。

- **入力**: プロジェクト名、動画、記事の範囲、Crop、台形補正、解析設定
- **解析結果**: スライド検出、文字起こし、OCR、スライド本文、要約、章構成
- **編集状態**: OCR補正、発話・本文編集、記事タイトル、workflow
- **ファイル台帳**: 動画、サムネイル、代表画像、音声などの管理パスと欠落状態

解析結果をプロジェクト全体JSONで置き換えない。再解析はrunと採用行を更新し、ユーザーが編集した本文やOCR補正を別の操作で保存する。

## 2. 実装構成

```text
src-tauri/
  migrations/0001_initial.sql   # 基本スキーマ
  src/db/
    mod.rs                       # DB facade、共通検証、公開境界
    assets.rs                    # 実ファイルのサイズ・SHA-256・欠落検査
    connection.rs                # 接続、migration、起動時整合性確認
    repositories.rs              # SQLと正規化行の読み書き
    services/
      mod.rs                     # run検証、transaction内の共通処理
      projects.rs                # project/video/article command
      analysis.rs                # 解析commit command
      documents.rs               # 原稿保存command
    tests.rs                     # 正規化復元・revisionテスト
  src/lib.rs                     # 起動時DB初期化とcommand登録

src/lib/storage/projectStorage.ts # invokeの型付き薄いクライアント
src/lib/storage/projectAssetTransactions.ts # asset退避・復旧transaction
src/lib/storage/projectAssets.ts # 管理assetのパス解決
src/lib/tauri/db.ts             # DB invokeの型付けとエラー正規化
src/app/App.tsx                    # 操作を計算し、対応commandを順に呼ぶ
src/lib/project/project.ts         # UI DTOの派生・無効化ルール
```

Rustの起動処理で次を一度だけ行う。

1. `AppLocalData/library/library.sqlite`を作成する。
2. SQLiteのWAL、`synchronous=FULL`、外部キー、busy timeoutを有効にする。
3. SQLx migrationを適用する。失敗した場合はUIを起動しない。
4. `assets`の実ファイルを確認し、欠落していれば`missing_at`を記録する。

## 3. commandの境界

### 3.1 プロジェクト・素材

| command                              | 用途                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| `db_create_project`                  | 空のプロジェクト行を作成                                        |
| `db_update_project`                  | タイトル、active article、更新時刻、project revisionを更新      |
| `db_create_video_and_update_project` | 動画・台帳asset作成とproject更新を同一transactionで確定         |
| `db_create_project_bundle`           | Homeからのproject・動画・初期記事を一括作成                     |
| `db_create_articles`                 | 複数の記事・documentとproject更新を一括作成                     |
| `db_update_article_and_project`      | 記事metadataとproject状態を同一transactionで更新                |
| `db_update_article_content`          | 複数slide本文、記事metadata、project状態を同一transactionで更新 |
| `db_update_article_source`           | 範囲・Crop更新と後続解析結果の初期化を同一transactionで更新     |
| `db_delete_article`                  | 記事と関連する解析・原稿・記事assetを削除                       |
| `db_delete_video`                    | 記事が参照していない動画だけを削除                              |
| `db_load_project`                    | 正規化テーブルから1プロジェクトをUI DTOへ復元                   |
| `db_list_projects`                   | 全プロジェクトを更新順で復元                                    |
| `db_delete_project`                  | FK cascadeでプロジェクトを削除                                  |

### 3.2 解析結果

| command                     | 保存するもの                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| `db_commit_slide_detection` | 検出run、スライド集合、代表画像asset、採用slide run                   |
| `db_commit_transcription`   | 文字起こしrun、発話segment、各スライドへの割当、採用transcription run |
| `db_commit_ocr`             | OCR run、raw結果、blocks、スライドごとの採用OCR                       |
| `db_commit_slide_content`   | スライド本文生成runと本文付きtranscript                               |
| `db_update_slide_results`   | 発話と採用OCRのユーザー編集を同一transactionで保存                    |
| `db_update_document`        | 要約・章構成・手動原稿編集、および要約/章生成run                      |

解析commitは対象articleの所属と開始時の`expected_revision`を検証する。別記事のslide、別runの結果、別projectのassetを参照できない。入力やスライドがcommit後に変わっていれば`REVISION_CONFLICT`で結果を採用せず、古い処理が新しい編集を上書きしない。

通常の画面保存はプロジェクト全体保存commandを経由しない。記事metadataとproject更新は操作単位のcommandで確定し、本文と採用OCRの編集も複数の低水準commandをUIから連続して呼ばずtransactionへまとめる。

## 4. SQLiteスキーマ

すべてのIDはRust側で検証する英数字・`_`・`-`の文字列。JSON列はRustでJSON化し、migrationでは`json_valid`を検証する。日時はUTC ISO 8601文字列、動画時刻と順番は整数ミリ秒・0始まりのpositionで保持する。

### 4.1 入力とasset

`projects`は`id`、`title`、アプリの`version`、`active_article_id`、作成・更新時刻、`revision`を持つ。

`assets`は管理対象ファイルの台帳で、`project_id`、相対参照、サイズ、SHA-256、`missing_at`を持つ。ファイルの実体や動画固有の情報をasset metadataへ重複保存しない。

`videos`はassetを参照し、タイトル、UIへ返す完全なmedia JSON、作成・更新時刻を持つ。動画の復元は`videos.media_json`を正本にし、assetからは管理パスとthumbnailパスだけを取得する。記事の元動画は同一project内の動画に限定する。

`articles`は動画ID、範囲JSON、矩形Crop、台形補正、解析設定、workflow、`revision`を持つ。解析結果や本文をこの行のJSONへ集約しない。

### 4.2 解析

`analysis_runs`は完了した解析runの`article_id`、kind、result、記録時刻を持つ。解析開始・終了を別行で管理せず、入力snapshotやconfigの未使用コピーも保存しない。kindは次の6種類。

```text
slide_detection / transcription / ocr
body_generation / summary_generation / chapter_generation
```

`slides`は採用中のslide runのスライド集合を保持し、detection、代表画像asset、スライドへ割り当てたtranscript JSONを持つ。検出の再実行は現在のslide行をtransactionで置き換え、run履歴とresult JSONは残す。

文字起こしのsegmentsは採用runの`analysis_runs.result_json`に保持する。現行UIは発話単位の検索・編集を行わないため、別のsegmentテーブルは持たない。`ocr_results`はraw text、ユーザー補正`edited_text`、OCR結果全体のmetadata JSON、revisionを保持し、`slide_ocr_selections`がスライドごとの採用結果を指す。

`article_material_selections`は記事ごとの採用slide runとtranscription runを明示する。最新時刻から採用結果を推測しない。

### 4.3 原稿

`documents`は記事と1対1で、要約・章構成を含むUI向けarticle JSONとdocument revisionを保持する。現行UIの本文単位はスライドtranscriptの`articleBody`であり、本文の生成・編集結果は`slides.transcript_json`、要約と章構成は`documents.article_json`に保存する。document固有の別IDや作成時刻は持たず、`article_id`を主キーにする。

## 5. 画面操作からDBまで

### プロジェクト作成

`createEmptyProject`でUI DTOを作り、空projectなら`db_create_project`、Homeから動画と記事を同時に開始する場合は`db_create_project_bundle`を呼ぶ。既存projectへの動画追加は、先にファイルを準備してから`db_create_video_and_update_project`で一括確定する。

### 動画・記事の追加と削除

動画追加はファイルコピー・サムネイル生成を操作serviceで行い、`db_create_video_and_update_project`でDBへ登録する。DB応答が不明な場合は参照確認が成功するまでassetを破棄しない。

記事追加は`db_create_articles`だけが記事行とdocument行を作る。記事削除はDB削除とassetの一時退避を組み合わせ、参照確認が成功した場合だけ復元・破棄を判断する。動画は参照記事が残っている場合、外部キーを壊すため削除を拒否する。

### Crop・範囲変更

`db_update_article_source`で入力更新、採用解析、スライド、発話、原稿の初期化を一つのtransactionで行う。旧JSONや旧summaryファイルの削除は行わない。

### スライド検出・文字起こし・OCR

各処理はsidecarやOS APIで計算した後、専用commit commandを呼ぶ。commitはrun、結果行、asset、採用行を一つのtransactionで保存する。画面の完了callbackはプロジェクト全体を再保存せず、必要なarticle metadataだけ`db_update_article`で更新する。

### 本文・要約・章の生成と編集

本文生成完了は`db_commit_slide_content`、本文の一括編集は`db_update_article_content`を呼ぶ。OCR完了は`db_commit_ocr`、OCRと発話の手動編集は`db_update_slide_results`を呼ぶ。要約生成と章構成生成、手動変更は`db_update_document`を呼び、生成時だけ対応するrunを追加する。

## 6. 競合とrevision

projectの更新には`expected_revision`を指定できる。現在値と違えば`REVISION_CONFLICT`を返し、行を変更しない。article、document、slide、OCR結果のrevisionを保存時に検証する。

現行UIの完了callbackは専用commit commandが入力情報と成功runを同一transactionで記録する。解析開始・終了を別commandで管理する経路は持たない。

## 7. ファイルの扱い

管理ファイルの相対参照はAppLocalData配下で解決し、`..`、絶対パスによる管理領域外への脱出を受け付けない。現在のファイル配置は次のとおり。

```text
projects/<project-id>/
  videos/<video-id>/original.<ext>
  videos/<video-id>/thumbnail.jpg
  articles/<article-id>/runs/slides/<run-id>/slide-001.jpg
  articles/<article-id>/runs/current/audio/source-16k.wav
```

DB行を削除しても実体削除を先に行わない。削除対象を`.trash/<operation-id>`へ移動し、DB commit後に一時領域を消す。失敗時は元のパスへ戻す。起動時のasset検査は`missing_at`を記録するだけで、勝手にDB行を削除しない。

アプリが退避中に終了した場合は、次回起動時にjournalとSQLiteの参照を突き合わせる。まだ参照されている記事・動画は元の場所へ戻し、DBから削除済みの退避は破棄する。

プロジェクト全体の削除も同じ方式で`project-trash/<project-id>`へ先に退避し、DB削除後に破棄する。途中終了時はDBの存在を見て復元または破棄する。

## 8. migrationと初期化

スキーマの正規ソースは`src-tauri/migrations/0001_initial.sql`だけにする。DBの版マーカーを手作業で比較したり、版不一致を理由に`projects`を削除したりしない。migration適用に失敗した場合はアプリを終了させ、DBを空にして続行しない。新規ユーザー向けの現行スキーマを一つのmigrationへ集約し、動画復元、解析結果、revision、採用行を最初から最終形で作成する。

新DBはSQLite専用の`library/`を使う。実行時に旧JSONと旧summaryは読まず、新規インストール直後の一覧は空になる。開発中に旧保存領域が残っていても、一覧やload commandがそこを探索してはいけない。

再設計前の開発DBは旧migrationのchecksumを持つため、そのままでは現行migrationと混在させない。ユーザーが存在しない開発環境では、既存の`library.sqlite`を退避して現行migrationから空DBを作る。ユーザーデータを保持する必要がある段階では、別の明示的な移行migrationを追加する。

## 9. 検証

実装時に次を実行する。

```text
bun test
bunx tsc -p tsconfig.app.json --noEmit
bun run lint
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml db::tests::normalized_indexes_round_trip_a_project -- --exact
git diff --check
```

DBテストは一時SQLiteへmigrationを適用し、動画、記事、スライド、OCR、文字起こし、要約、章を正規化行から復元できることを確認する。画面側は、プロジェクト全体を一度に保存する呼び出しが存在しないことを`rg`で確認する。

## 10. 実装済みファイル

- [db/mod.rs](../src-tauri/src/db/mod.rs): DB facade、共通検証、公開モジュール境界
- [db/connection.rs](../src-tauri/src/db/connection.rs): SQLite接続、migration、asset検査
- [db/repositories.rs](../src-tauri/src/db/repositories.rs): SQLと正規化行の読み書き
- [db/assets.rs](../src-tauri/src/db/assets.rs): 実ファイルのmetadataとchecksum
- [db/services/mod.rs](../src-tauri/src/db/services/mod.rs): run検証とtransaction内共通処理
- [db/services/projects.rs](../src-tauri/src/db/services/projects.rs): project/video/article command
- [db/services/analysis.rs](../src-tauri/src/db/services/analysis.rs): 解析commit command
- [db/services/documents.rs](../src-tauri/src/db/services/documents.rs): 原稿保存command
- [db/tests.rs](../src-tauri/src/db/tests.rs): 正規化復元・revisionテスト
- [0001_initial.sql](../src-tauri/migrations/0001_initial.sql): 現行SQLiteスキーマ
- [lib.rs](../src-tauri/src/lib.rs): 起動時初期化とcommand登録
- [projectStorage.ts](../src/lib/storage/projectStorage.ts): 操作単位のinvokeクライアントとrevision snapshot
- [projectAssetTransactions.ts](../src/lib/storage/projectAssetTransactions.ts): asset退避、復旧、ロールバック
- [projectAssets.ts](../src/lib/storage/projectAssets.ts): 管理assetのパス操作
- [db.ts](../src/lib/tauri/db.ts): DB command呼び出しと`DbError`正規化
- [App.tsx](../src/app/App.tsx): 画面イベントと対応commandの順序制御
- [project.ts](../src/lib/project/project.ts): workspace DTOの更新・無効化ルール
