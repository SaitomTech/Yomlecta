# SQLiteレビュー指摘1〜5の対応設計

作成日: 2026-09-20

この文書は実装前の設計案。対象は現在の未コミット差分に対するレビュー指摘1〜5。既存の `sqlite-detailed-design.md` に記載された実装構成を、以下の操作境界へ変更する。実装完了時に同文書と設計ガイドを更新する。

## 1. 結論と対象

個々の不具合をAppの追加invokeで補うのではなく、1回のユーザー操作を1回のDB transactionとして扱う。

| 指摘                                | 原因                                           | 対応                                                          |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| 1. Crop後のdocument revision不整合  | DB更新後のrevisionをクライアントへ返していない | Crop変更を専用commandへ統合し、変更した全revisionを返す       |
| 2. 再検出で文字起こしが消える       | TSの保持ルールとDBの削除ルールが異なる         | 採用transcriptionを保持し、再割り当て済みtranscriptを保存する |
| 3. OCR更新後に旧本文が復活する      | OCRと本文無効化が別の保存対象になっている      | OCR・採用結果・対象slide transcriptを同時更新する             |
| 4. 復旧時に必要なファイルを削除する | 読み込みエラーと不存在を混同している           | 専用の参照確認と保守的な復旧判定を導入する                    |
| 5. Appに保存と補償処理が集中する    | テーブル単位のAPIをUIが組み合わせている        | React非依存の操作serviceとRustの操作transactionへ移す         |

スキーマ変更は原則不要。既存のrevision、採用行、transaction、退避ディレクトリを利用する。指摘6のテスト専用保存実装の全面置換は対象外だが、今回の回帰テストは本番serviceを通す。

## 2. 保証すること

1. 操作成功後の画面データと、同じprojectを再読込したデータが一致する。
2. 関連DB更新は全成功または全rollbackとし、結果だけ削除して入力更新に失敗する状態を作らない。
3. DBを変更したcommandは、変更したrevisionを必ず返す。クライアントが次回更新を無条件更新へ切り替えて回避しない。
4. 正常なDB応答によって参照なしと確認できた場合だけ、退避ファイルを破棄する。
5. DB commit後のファイル回収失敗を、DB操作失敗やDB rollbackとして扱わない。
6. UIは保存順序・SQLの分割・ファイルの復旧方法を知らない。

## 3. 責務と配置

```text
App.tsx
  → useProjectWorkspace.ts（React state、操作queue、画面反映）
    → projectOperations.ts / articleOperations.ts（ユーザー操作）
      → project.ts等（純粋なDTO更新・無効化ルール）
      → projectStorage.ts（型付きcommandクライアント、revision）
        → tauri/db.ts（invoke、エラーの正規化）
          → Rust command（引数・Stateの受け取り）
            → Rust service（検証、transaction、結果）
              → repository（SQL）
      → projectAssetTransactions.ts（ファイル退避・復旧）
```

| 配置                                          | 担当                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `src/app/App.tsx`                             | 画面の組み立て、ルート選択、画面へのcallback接続          |
| `src/app/useProjectWorkspace.ts`              | project state/ref、既存の操作queue、操作成功時のstate更新 |
| `src/lib/project/projectOperations.ts`        | 新規取り込み、動画追加、複数記事作成、削除の調整          |
| `src/lib/project/articleOperations.ts`        | Crop、解析完了、編集保存のDTO計算とcommand呼び出し        |
| `src/lib/project/project.ts`                  | 現在の純粋な状態変更ルール。I/Oを追加しない               |
| `src/lib/storage/projectStorage.ts`           | commandごとのrequest/response、revision取得・反映         |
| `src/lib/storage/projectAssetTransactions.ts` | DB参照確認を使う退避・復旧。DTOのparseをしない            |
| `src-tauri/src/db/services/*`                 | 操作単位のtransaction。UIのルートやReactには依存しない    |
| `src-tauri/src/db/repositories.rs`            | transactionを受け取る読み書き。自分でcommitしない         |

Tauri commandと本体は同一ファイル内で分けられる。commandは `State<DbState>` を取り、本体は `&DbState` と型付きrequestを取る。これだけで実DBを用いたserviceテストが可能になる。汎用repository trait、DIコンテナ、command busは導入しない。

## 4. 共通の保存契約

### 4.1 入力を操作に限定する

`MediaProject` や `Article` 全体をRustへ渡す契約を、今回変更する経路から減らす。DTO更新関数で得た値のうち、その操作が保存する項目だけをrequestへ明示する。

例: Crop requestはproject/article ID、範囲、crop、台形補正、変更後workflow、更新時刻、expected revisionsを持つ。slidesやOCRを任意に渡せる汎用patchにはしない。

Rust側では所属、ID、対象行、revision、必須フィールドを検証する。TypeScriptは業務上の状態変更を計算し、Rustはその変更を一貫して永続化する。TSとRustの双方に別々の本文無効化アルゴリズムを実装しない。

### 4.2 更新結果とrevision

変更した実体だけを返す共通形を使う。各commandの具体型では必要なフィールドを必須にする。

```ts
type RevisionChanges = {
  project?: { id: string; revision: number }
  article?: { id: string; revision: number }
  document?: { articleId: string; revision: number }
  slides?: Array<{ id: string; revision: number }>
  ocr?: Array<{ slideId: string; resultId: string; revision: number }>
  removedSlideIds?: string[]
}
```

`projectStorage` の単一関数で変更を反映する。Crop・再検出で消えたslideについてはslide/OCRキャッシュを削除する。新規slideは0、文字起こしで更新したslideは実際の更新後revision、新規OCR結果は0を登録する。現状のようにcommit成功後にrevisionを単に削除してexpectedRevisionを省略しない。

既存行の変更ではexpectedRevisionを必須にする。キャッシュ欠落時は操作開始前に再読込し、改めて現在データから更新内容を計算する。計算済みの古い変更へ新しいrevisionだけを付け直さない。

操作成功時は「revision反映→保存した内容に一致するDTOのstate反映」を行う。Rustがタイトルtrim等を正規化する場合は、TSと同じ正規化契約を使うか、その確定値も返す。commit直後に全projectの再読込を必須にすると、読込失敗を保存失敗と誤認しやすいため採用しない。

### 4.3 transactionの範囲

transaction内は、所属・revision検証、対象行変更、関連metadata/workflow変更、revision採番まで。動画コピー、ダウンロード、ffmpeg、画像生成は含めない。

操作に伴うproject.updatedAtとarticle.workflowの変更は同じtransactionへ含める。`persistActiveArticle` による後続の別commitを廃止する。projectの更新時刻だけを変える操作は、title/activeArticleIdを上書きしない。これらの値を変更する操作だけ、project revisionによる競合検証を行う。

### 4.4 失敗時の区別

通常の失敗はstateを変更せず、入力や解析結果を画面に残す。revision競合を自動再試行しない。

ファイル回収を伴う操作では、最低限「rollback確定」「commit結果不明」「commit成功後の回収失敗」を区別する。transaction開始・検証・SQL実行エラーでrollbackが完了した場合だけ `not_committed` と扱う。commit応答やIPCが不明な場合は `unknown` とし、DB参照を確認するまでファイルを破棄しない。

エラー正規化には必要な範囲で `outcome: 'not_committed' | 'unknown'` を追加する。単なるネットワーク/IPC例外を `not_committed` に変換しない。成功後の回収失敗は成功結果とcleanup warningで表現する。

## 5. 指摘1: Crop変更とrevision同期

`db_update_article_source` を設け、独立commandとしての `db_reset_article_outputs` を廃止する。内部の結果削除SQLはtransactionを受け取る関数として再利用する。

同一transaction内で次を実行する。

1. project/articleの所属、article/documentのexpected revisionsを確認する。
2. source range、crop、perspective crop、workflowを更新する。
3. slide OCR採用行、slides、不要になったslide asset行を削除する。
4. articleのslide/transcription採用をNULLにする。
5. documentのarticle JSONをNULLにし、revisionを増やす。
6. article revisionとprojectの更新時刻・revisionを更新する。
7. project/article/documentのrevisionと削除slide IDを返す。

解析run履歴の削除範囲は現行仕様を維持する。実ファイルの削除をこのtransactionへ混ぜない。現行の「Crop確定で後続出力を初期化する」仕様も維持する。同じCropなら無効化しない、という追加仕様は今回含めない。

これにより初回Crop確定後でもdocument revisionが0のまま残らず、要約・章構成を続けて保存できる。途中SQL失敗時は旧Cropと旧出力がまとめて残る。

## 6. 指摘2: 再検出時の文字起こし保持

既存TypeScriptの仕様に合わせる。範囲・Cropが変わった場合は前項で無効化するが、スライドの境界再検出だけなら音声の文字起こしは保持する。

`db_commit_slide_detection` のrequestに再割り当て済みslidesを渡し、DBは各slideの `transcript` を保存する。INSERTでNULL固定にしない。`article_material_selections.transcription_run_id` は現在の値を保持する。

| 対象                              | 再検出での扱い                                              |
| --------------------------------- | ----------------------------------------------------------- |
| 採用文字起こしrun・segments       | 保持                                                        |
| slideへの発話割り当て             | 新しい区間に対してTSで再計算し、保存                        |
| 旧slideのOCR・生成本文            | 新しいslide集合へ引き継がない                               |
| 新slide・画像asset・採用slide run | 一括置換                                                    |
| workflow・解析設定・更新時刻      | 同じtransactionで更新                                       |
| 要約・章構成                      | 今回は現行のDTO更新ルールを維持。新しい失効方針は追加しない |

`updateProjectSlideDetection` が同じprojectを返した場合はno-opとしてDB置換を行わない。既存OCRや本文を、同じ検出結果の再保存だけで消さないために必要。

入力には、計算時に参照したarticle revisionと必要な採用run IDを含める。DBが保持するtranscriptionが計算時と違えば競合として拒否し、古い発話割り当てを新しいrunと結び付けない。

## 7. 指摘3: OCRと本文無効化の一括保存

`articleOperations` は `updateProjectSlideOcr` で変更後のslideを計算し、OCRとそのslideの変更後transcriptを `db_commit_ocr` に渡す。transcriptは省略で意味を変えず、明示的な値またはNULLとする。

同一transaction内で次を実行する。

1. 対象article/slide、期待するrevisionと採用OCR結果IDを確認する。
2. analysis runとraw OCR結果を追加する。
3. 採用OCR結果を切り替える。
4. 対象slideのtranscriptを置換する。raw/modelは残り、articleBodyと生成metadataはTSの既存ルールに従って消える。
5. workflow、article/projectの更新時刻・revisionを更新する。
6. 新OCR結果ID/revisionとslide/article/project revisionsを返す。

同一OCRで純粋関数が変更なしと判定した場合はno-op。新しいrunの追加も本文の削除も行わない。ユーザーによるOCR手動補正は別操作のままとし、手動で編集した本文まで自動削除する仕様へ拡大しない。

OCR完了と本文保存が競合した場合、対象slide revisionで片方を拒否する。OCRの採用切替では結果IDも確認し、異なるOCR結果のrevision 0同士を同一と見なさない。

## 8. 指摘4: 退避復旧の安全な判定

### 8.1 DTO復元を参照確認から外す

`db_check_storage_reference` を追加する。引数はproject IDと、対象を表す判別可能な型（project/article/video）。応答は正常なSQL結果に基づく `{ referenced: boolean }`。

projectはprojectsの存在、article/videoはIDとproject_idの両方で確認する。SELECT EXISTSだけを行い、JSON parse、ファイル検査、DTO復元をしない。SQLエラーは例外で返し、falseにしない。

これはファイル破棄の根拠を得るための専用APIであり、汎用SQL公開APIにはしない。

### 8.2 復旧判定表

| DB確認      | 元パス | 退避パス | 動作                                            |
| ----------- | ------ | -------- | ----------------------------------------------- |
| 参照あり    | なし   | あり     | 元パスへrename。成功後だけjournalを回収         |
| 参照あり    | あり   | あり     | 両方保持し警告。どちらが正しいか推測しない      |
| 参照あり    | あり   | なし     | 復元済みとして空のjournalを回収                 |
| 参照あり    | なし   | なし     | 欠落として警告。復元成功と記録しない            |
| 参照なし    | 任意   | あり     | 退避だけを破棄。元パスは触らない                |
| 参照なし    | 任意   | なし     | journalを回収                                   |
| 確認失敗    | 任意   | 任意     | ファイルとjournalを保持し、次回再試行可能にする |
| journal不正 | 任意   | 任意     | 保持して警告                                    |

project全体の退避とarticle/videoの退避は同じ判定規則を使う。restore失敗後のfinallyで退避領域を削除する経路も除去する。削除対象は検証済みIDから組み立て、journalの任意パスをそのまま採用しない。

### 8.3 通常削除にも同じ規則を適用する

「退避→DB削除→退避回収」とし、DB削除後のDTO読込をrollback判定用tryブロックに入れない。読込失敗はDB削除成功とは別の問題として再読込を促す。

DB削除が失敗した場合も、結果不明なら参照確認を行ってから復元/回収を決める。復元失敗時はjournalを残す。退避回収だけに失敗した場合は削除成功としてUIへ返し、次回起動で再回収する。

すべてのstorage公開操作が初期化を待つ。復旧は同じ初期化Promise内で一度行い、通常のmutationと並行させない。復旧内の参照確認は初期化を再入呼び出しせず、直接read commandを呼ぶ。

## 9. 指摘5: 操作単位のAPI

既存の低水準CRUDをAppから順に呼ぶ構成を、以下に置き換える。既存command名は意味が変わらないものを再利用する。

| 操作                         | DB transactionに含めるもの                                 |
| ---------------------------- | ---------------------------------------------------------- |
| 空project作成                | project作成                                                |
| Homeから動画取り込み         | project、video/asset、初期article/document、active article |
| 既存projectへの動画追加      | video/asset、project更新時刻                               |
| 複数article作成              | 全article/document、project更新時刻                        |
| Crop確定                     | 入力変更、後続出力初期化、workflow、revision               |
| 検出/文字起こし/OCR/本文完了 | 結果、関連slide、採用行、workflow、revision                |
| スライド結果編集             | transcript、OCR補正、workflow、revision                    |
| 記事の本文一括編集           | 変更したslides、タイトル、必要なdocument項目、workflow     |
| 要約・章構成保存             | document、必要な生成run、workflow、revision                |
| タイトル・画面到達状態更新   | 当該metadataのみ。関連する重複タイトルも同時同期           |
| article/video/project削除    | 既存のDB削除一式。ファイル退避はTS側                       |

### 9.1 取り込み

ローカル/YouTubeは入力取得だけ分け、取得済み動画からの登録は同じ `projectOperations` 関数を呼ぶ。既存 `addProjectVideo` のコピー・thumbnail生成を再利用する。

準備した動画と記事DTOを一度の登録commandに渡す。DB失敗の補償として作成済み行を1件ずつ削除する処理はなくなる。複数記事作成も1 transactionなので、registeredArticleIdsを追跡して逆順削除する必要がない。

ファイルはDB transaction前に準備する。rollback確定時だけ今回作成したファイルを回収する。応答不明なら生成済みIDでDB参照を確認する。参照ありは保持して再読込、確認失敗は保持してエラー報告とする。既存project全体を補償削除しない。

今回の範囲では、準備中のプロセス強制終了による未登録ファイルの自動GCは追加しない。DB+ファイルの完全な分散transactionは保証しない。少なくとも参照中ファイルを誤って消す補償処理を除去する。

### 9.2 queueとReact

現在のAppの操作queueをhookへ移し、project state更新まで直列化する。storage側の削除専用queueは、この操作入口へ統合する。queueを増やして二重に待機する構成にしない。

操作serviceはReact stateを直接変更せず、確定したnext projectや作成articleを返す。Appに残るのは操作呼び出しと画面遷移。exportの生成はDB commit後に行い、export失敗でDB保存を巻き戻さない。

### 9.3 非同期解析の対象を固定する

結果を保存するときのactiveArticleIdを対象にしない。処理開始時のproject/article/slide IDを結果と一緒に保持する。

必要な入力の照合値も開始時に取得する。検出ではsource設定と採用transcription、OCRでは入力画像と対象slide/OCR選択を用いる。保存直前の最新revisionを古い結果へ無条件に付けると、競合検出をすり抜けるため禁止する。

記事全体のrevisionを解析バッチ開始時に一度だけ固定し、各slideの保存で増加させる設計にも注意する。同一バッチの2枚目以降が自分の更新と競合してしまう。slide単位の結果は対象slideのrevisionと入力照合値を使い、articleの表示metadata更新とは区別する。新たなjobテーブルや汎用非同期フレームワークは不要。

## 10. 実装順序

1. command本体をState非依存で呼べる形へ分離し、型付きrequest/responseとrevision反映関数を追加する。
2. 参照確認APIと退避復旧を修正する。ファイルを削除しないことを失敗系テストで先に保証する。
3. Crop専用commandを実装し、revision返却・同期とApp側の2段階保存を置換する。
4. 検出・OCRのcommandを変更し、DTOと再読込の一致を検証する。
5. 取り込み・複数記事作成・編集保存を操作単位のtransactionへまとめる。
6. operation serviceとhookへAppの処理を移し、旧command・旧queue・重複cleanupを削除する。
7. 実機の一連の操作と既存テストを確認し、設計書の現状説明を更新する。

途中段階で新旧の同じ保存操作を両方呼ばない。commandと呼び出し元を同じ変更単位で切り替える。

## 11. 検証と完了条件

テスト用SQLiteへmigrationを適用し、本番serviceを呼ぶ。今回のテストのために別の保存ロジックを増やさない。

| ケース                               | 検証する内容                                                  |
| ------------------------------------ | ------------------------------------------------------------- |
| 初回Crop→要約→章保存                 | 再読込せず連続成功し、DB/クライアントrevision一致             |
| 出力のある記事のCrop変更             | 入力と全対象出力が同時更新。途中失敗なら全部保持              |
| 文字起こし済み記事の境界再検出       | transcription採用を保持。新slide rawが画面/再読込で一致       |
| 同一検出結果の再保存                 | no-opとなりOCR/本文が消えない                                 |
| OCR変更                              | raw/modelを保持し生成本文metadataを削除。再読込でも復活しない |
| 同一OCRの再通知                      | run/revisionの不要な増加と本文削除なし                        |
| 本文編集とOCR確定の競合              | 古い方の保存を拒否し、部分更新しない                          |
| 復旧時のSQL/IPCエラー                | 元・退避ファイルを削除しない                                  |
| DTOだけが復元不能なproject           | 参照確認は成功し、退避ファイルを復元できる                    |
| 元と退避の両方が存在                 | 両方保持し、警告する                                          |
| restore/cleanup失敗                  | journalが残り再実行できる。削除済みDB行を復活扱いしない       |
| Home取り込み・動画追加・複数記事作成 | SQLの途中失敗で部分登録が残らない                             |
| commit応答が不明                     | 参照確認まで準備ファイルを保持し、盲目的に再登録しない        |
| 解析中の画面/記事切替                | 別記事へ結果が保存されない                                    |

フロント側にはmock commandを使ったrevision同期とqueueのテスト、ファイル操作mockを使った復旧判定表のテストを追加する。Rust側ではSQL制約違反等を用いてtransaction途中の失敗を発生させ、rollback後の行を確認する。テスト目的の汎用fault injection機構は本番へ追加しない。

最終確認は `bun test`、TypeScript型検査、Rust DBテスト、build/lint、React Doctor、`git diff --check`。実機では「取り込み→Crop→検出→文字起こし→OCR→本文→要約/章→再検出→再読込」を実行する。

完了条件は、指摘1〜4の回帰テスト成功と、Appから複数DB commandの連続呼び出し・ファイル補償削除がなくなること。大きな汎用化や未使用の拡張API追加は行わない。

## 12. 今回残る制約

代表画像は一意な `runs/slides/<run-id>` に生成してからDBへ保存する。保存に失敗した場合は新しいrunだけを削除し、採用中の代表画像を維持する。保存成功後に以前のrunと旧 `runs/current/slides` を回収する。

要約・章構成が参照する入力の変更に対して、どこまで自動無効化するかは今回の3件の保存不整合と分ける。今回の実装は既存の純粋関数が計算した状態を確実に永続化するところまでとし、追加の失効ルールはユーザー向け挙動の変更として別に扱う。
