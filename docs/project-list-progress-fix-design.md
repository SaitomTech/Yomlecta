# 一覧の進捗判定の修正設計

作成日: 2026-09-20
状態: 実装済み
対象: レビュー指摘1「一覧の進捗判定が重複し、実際に表示がずれている」

## 結論

一覧の進捗集計・再開ステップ判定は、現在本番で使用しているRustの一覧読取処理に一本化する。
OCRの有効値を詳細読込と一致させ、空文字への手動編集も正しく完了数に反映する。
本番から呼ばれていないTS側のsummary生成・進捗判定を削除する。

前回レビューではTS側への集約も候補に挙げたが、呼出し元を確認すると
`buildProjectSummary` と `getProjectProgress` は未使用で、`getProjectResumeStep` もテストからしか使われていない。
TSへ判定を移すためにIPCの読取モデルを増やす必要はない。
既存の設計文書にある「TSでprojectionからsummaryを作る」案は、今回の対象については本設計で置き換える。

## 原因

`db_commit_ocr` はOCR本文を `ocr_results.raw_text` と `metadata_json.rawText` の両方に保存する。
手動編集は `edited_text` のみを更新する。

- 詳細読込: `edited_text` がNULLでなければ採用し、NULLなら `raw_text` を採用する。
- 一覧集計: `metadata_json.rawText` を優先するため、手動編集が集計に反映されない。
- 空白判定: SQLiteの引数なし `TRIM` は半角スペースしか除去せず、既存TSの `String.trim()` と異なる。
- TSにも一覧判定が残り、既存の再開ステップテストは本番のRust実装を検証していない。

## 責務

| 箇所 | 今回の責務 |
| --- | --- |
| `src-tauri/src/db/repositories.rs` | 有効なOCR値の読取、一覧の件数集計、再開ステップ判定 |
| `src-tauri/src/db/services/projects.rs` | 既存の一覧commandとproject単位のエラー返却を維持 |
| `src/lib/storage/projectStorage.ts` | 一覧command呼出し、既存のファイル存在確認、並べ替えを維持 |
| `src/types/project.ts` | 既存の `ProjectSummary` / `ProjectListEntry` を維持 |

## 有効なOCRの契約

採用する結果行と、その行の本文を区別する。

1. `slide_ocr_selections` があれば、指定されたOCR結果行を使用する。
2. 選択行がなければ、詳細読込の既存仕様に合わせて最新のOCR結果行を使用する。
3. 最新行の順序は `created_at DESC, id DESC` に揃える。時刻が同じ場合も結果を確定させる。
4. 有効な本文は `COALESCE(edited_text, raw_text)` とする。
5. `edited_text = ''` は「空に編集した結果」であり、元の本文へフォールバックしない。
6. `metadata_json.rawText` は本文の判定に使わない。既存データと書込形式はそのまま保持する。

一覧と詳細読込で結果行の選択を揃えるため、同じ `repositories.rs` 内に
スライドIDを基準に採用OCR IDを求める固定SQL断片を置き、両queryから使用する。
対象外の記事・スライドのOCRを採用しない所属条件も含める。
SQL断片はコード内の定数だけで構成し、ユーザー入力は従来どおりbindする。
新しいSQL生成基盤やqueryごとのDBアクセスは追加しない。

詳細読込でも有効本文をSQLの `COALESCE` で取得し、返却DTOの `ocr.rawText` に設定する。
metadata内に古い `rawText` があっても、この値で上書きする。

## 完了数と空白の契約

| フィールド | 判定 |
| --- | --- |
| `slideCount` | 現行queryが対象とするスライドの件数 |
| `ocrCompleted` | 有効なOCR本文が空白だけではないスライド数 |
| `articleTarget` | `transcript.raw` が空白だけではないスライド数 |
| `articleCompleted` | `transcript.articleBody` が空白だけではないスライド数 |

空白の定義は既存TSの `String.trim()` と同じ文字集合にする。
Rustに固定文字列を一つ定義し、三つの集計で `TRIM(value, ?)` の第二引数へbindする。
対象は U+0009〜000D、0020、00A0、1680、2000〜200A、2028、2029、202F、205F、3000、FEFF。
NULLは空文字として扱う。U+200Bは空白扱いしない。
独自SQLite関数や全文のIPC転送は導入しない。

本文完了数を発話ありのスライドだけに絞る等、既存の計数仕様は変更しない。

## 重複実装の削除

`src/lib/project/projectProgress.ts` を削除する。
`tests/project-workflow.test.ts` の同ファイルへのimportと、再開ステップ専用テストを削除する。
同テストの「初期cropがあっても最終表示がcropならcropへ戻る」という保証は、Rustの一覧読取テストへ移す。
他のworkflow・記事更新テストは維持する。

Rustの再開ステップ判定は既存の優先順を維持する。
今回のために新しいpolicy層やTSの代替関数は追加しない。

## 回帰テスト

`src-tauri/src/db/tests.rs` にmigration済みin-memory SQLiteのfixtureを用意し、
本番の `load_project_summary` と `load_project_from_indexes` を呼ぶ。
集計対象の行を作る直接SQLは読取テストのfixtureに限定する。
結果を模倣した別集計関数や、テスト専用の保存サービスは作らない。

| 条件 | 期待 |
| --- | --- |
| raw本文あり・編集NULL | OCR完了1、詳細もraw本文 |
| raw本文あり・編集空文字 | OCR完了0、詳細も空文字 |
| raw本文空文字・編集本文あり | OCR完了1、詳細も編集本文 |
| metadata本文と編集本文が不一致 | metadata本文が計数へ影響しない |
| 編集本文が半角空白・改行・タブ・全角空白・NBSP・BOMのみ | OCR完了0 |
| 本文がU+200Bのみ | 空白とはみなさず完了1 |
| OCR結果が複数あり、古い結果を明示選択 | 最新結果ではなく選択結果で集計・詳細表示 |
| 選択行なし・結果が複数あり | 一覧と詳細で同じ最新結果を使用 |
| OCR結果なし、スライドなし | 対応する完了数は0 |
| 発話・記事本文が空白のみ／本文あり | `articleTarget` / `articleCompleted` が契約どおり |
| 初期cropあり・lastVisitedStepがcrop | resumeStepはcrop |
| 記事なし、検出なし、画像参照なし、export、article-review、通常 | 既存の再開ステップ優先順を維持 |

空白テストは上記文字集合全体をパラメータ化して確認する。
詳細読込DTOから期待する有効本文が得られることと、一覧の件数が合うことを同じfixtureで確認する。

## 作業順と完了条件

1. 編集前後で一覧と詳細がずれる回帰テストを追加して失敗を確認する。
2. OCR行選択と有効本文、三つの集計の空白判定を修正する。
3. 再開ステップのテストをRustへ移し、未使用TS実装を削除する。
4. `bun test`、`cargo test --manifest-path src-tauri/Cargo.toml --lib db::`、
   `bunx tsc -b --pretty false`、`git diff --check` を実行する。

完了条件は、編集後の有効OCR本文と一覧の完了数が一致し、一覧の判定実装がRustだけに存在すること。
UIで進捗値を表示する箇所がある場合は、OCRを空に編集して一覧を再取得する操作も確認する。

## 今回の対象外

レビュー指摘2〜5（保存request、起動時asset検査、一覧N+1、Appのhook責務）は変更しない。
DBスキーマ・migration・保存処理・IPC形式・UI・health判定・サムネイル選択・履歴切替仕様も変更しない。
一覧の検出run・スライド選択全体の再設計やsnapshot整合性の改善は含めない。
