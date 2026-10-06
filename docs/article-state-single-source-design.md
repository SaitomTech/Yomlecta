# 記事状態の正本統一設計

作成日: 2026-10-06
状態: 実装済み。記事・映像区間・記事ブロック・原稿の責務を分離。
前提: `069190a`でAppの保存・更新制御とページ構成を分離済み。

## 1. 目的と決定

記事の編集対象を一つにし、`syncActiveArticle`によるコピーの書き戻しを廃止する。読み込み、純粋更新、保存、解析、ページ表示、エクスポートを一括して新しい契約へ移す。

永続データの正本はSQLite。画面側では、読み込んだ各記事について一つの`Article`だけを編集状態として保持する。`activeArticle`はその記事への参照を返すselectorであり、別のstateには保存しない。

記事一覧には未読込の記事も必要なため、metadataと詳細を型で区別する。選択中の記事だけ詳細を読み込む現在の方針を維持し、未読込の記事を空のスライド付き詳細に見せない。

今回まとめて解消する重複は次の三つ。

| 対象                 | 現在                                                            | 正本                                                                 |
| -------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| 記事詳細             | `articles[]`内の詳細とproject直下の編集フィールド               | 読込済みentry内の`Article`                                           |
| 記事タイトル         | `Article.title`と`ArticleData.title`                            | `Article.title` / SQLiteの`articles.title`                           |
| ブロックの発話・本文 | `ArticleBlock.transcript`と表示hostの`VisualSegment.transcript` | `ArticleBlock.transcript` / SQLiteの`article_blocks.transcript_json` |

文字起こしエンジンの元結果と、記事ブロックへ割り当て・編集した発話は用途の違うデータとして保持する。翻訳されたタイトルも翻訳結果として保持する。

## 2. 現状の問題

- `types/project.ts`の`ArticleWorkspace`が`PersistedProject`を拡張し、選択記事の解析結果・設定・workflowをproject直下にも持つ。
- `articleToWorkspace`で詳細を展開し、`syncActiveArticle`で配列内の詳細へ書き戻す。更新関数によって配列、直下、両方のどこを更新するかが異なる。
- `schemas/project.ts`の`workspaceFor`が同じ展開処理を別に持ち、記事のないprojectにも仮の動画、設定、workflowを作る。
- Rustの`load_project_from_indexes`は対象記事だけ詳細を読み込み、他の記事には`slides: []`、`articleBlocks: []`を入れる。TypeScript上では全件が`Article`になる。
- 明示した詳細記事とDBに保存された`active_article_id`が異なる場合、読み込み後に`activateArticle`で再調整する必要がある。
- タイトル編集は原稿JSONのタイトルも更新する。本文編集はブロックとhost映像区間の発話を両方更新する。

## 3. 型と状態

### 3.1 metadataと詳細

```ts
type ArticleMetadata = {
  id: string
  title: string
  sourceVideoId?: string
  sourceRange: VideoTrimRange
  crop?: CropRegion
  perspectiveCrop?: PerspectiveCrop
  workflow: ProjectWorkflow
  createdAt: string
  updatedAt: string
}

type Article = ArticleMetadata & {
  inputMedia: ArticleInputMedia
  settings: ProjectSettings
  visualSegments: VisualSegment[]
  blocks: ArticleBlock[]
  slideDetection?: SlideDetectionResult
  transcription?: TranscriptionResult
  document?: ArticleDocument
}

type ProjectArticleEntry =
  { kind: 'metadata'; metadata: ArticleMetadata } | { kind: 'loaded'; article: Article }

type Project = {
  version: number
  id: string
  title: string
  videos: ProjectVideo[]
  articles: ProjectArticleEntry[]
  lastOpenedArticleId?: string
  createdAt: string
  updatedAt: string
}

type WorkspaceState = {
  project: Project | null
  activeArticleId: string | null
}
```

`ArticleDocument`は現在の`ArticleData`から`title`を除いたもの。boundaryPlan、summary、sections、translations、outputLanguageを保持する。記事の有無は`activeArticle`、原稿の有無は`article.document`で判断する。

`VisualSegment`から`transcript`を除く。ブロックの発話・本文の型は`BlockTranscript`として独立させ、`VisualSegment['transcript']`を参照しない。OCRは映像区間に属する結果として残す。

`inputMedia`のpreparation情報と参照/準備済み動画の再生仕様は今回維持する。project直下の`source`は廃止し、`resolveArticleSource(project, article)`で実行時のsource・range・cropを取得する。動画の管理形式や保存パス変更は別の変更とする。

### 3.2 不変条件

- entryのIDはproject内で一意。一つのIDについてmetadata entryとloaded entryを同時に持たない。
- 記事が未選択なら`activeArticleId`はnull。選択中なら、同じIDのloaded entryが存在する。
- 同時に保持するloaded entryは原則一つ。他の記事を開いたら以前の記事はmetadata entryへ落とす。
- `activeArticle`はloaded entry内のarticleと同じ参照。別コピーや別useStateを作らない。
- projectにはsource、crop、settings、visualSegments、blocks、transcription、document、workflowを直下に置かない。
- 記事のないprojectは通常の状態。仮の動画や仮のworkflowは作らない。
- DBの`active_article_id`は最後に開いた記事の記録。画面で今読み込んだ記事のIDと区別し、`lastOpenedArticleId`として公開する。

### 3.3 一覧と表示用の派生データ

`articleMetadata(entry)`はmetadata entryならそのmetadataを、loaded entryならarticleのmetadataフィールドを返す。記事マップ、切り替えパネル、削除確認、進捗表示はこのselectorを使う。

metadataを別stateで更新しない。loaded記事のタイトルやworkflowを編集すると、一覧表示もそのarticleから直接派生する。独立した一覧画面の検索結果は読み込みキャッシュとして扱い、編集成功後の再取得で更新する。

`ArticleBlockView`はブロック、host映像区間、画像、OCRを結び付ける読み取り専用の表示モデル。現在の`articleBlockViews`が行う結合を引き継ぐが、結果を編集stateへ戻さない。画像のないブロックも表示できる。本文更新は必ずblock IDを使う。

block IDとhost segment IDが一致する現在の仕様は維持する。API引数・型の名前でblock IDとsegment IDを区別し、将来の変更に備えて同一IDという前提を呼出し元へ散らさない。

## 4. 読み込みとIPC

### 4.1 戻り値

`db_load_project`の戻り値は次の形へ変更する。

```ts
type LoadedWorkspacePayload = {
  project: unknown // Project: entriesがmetadata/loadedを区別する
  loadedArticleId: string | null
  revisions: RevisionSnapshot
}
```

project直下に記事詳細を展開しない。詳細取得対象はRustで一度だけ決め、`loadedArticleId`、loaded entry、revision snapshotの対象を一致させる。明示したarticleIdがあれば優先し、未指定ならDBの最後に開いた記事を使う。DBの記録は読み込みだけでは書き換えない。

Zodでproject全体、entryの一意性、所属動画、loaded entryとloadedArticleIdの一致を検証する。解析成功後にだけrevision snapshotを採用する。project内の記事が全件metadataでも有効だが、その場合loadedArticleIdはnullでなければならない。

複数SELECTで詳細とrevisionがずれないよう、読み込みとrevision snapshot取得を同じSQLite read transactionに入れる。各repository helperはそのtransactionを使う。

### 4.2 Rustの変更

`repositories.rs`はmetadata entryとloaded entryを明示的に組み立てる。未読込の記事に空の解析配列や入力動画の詳細を詰めない。

詳細記事の映像区間読み込みから、ブロック本文をsegmentのtranscriptへ投影する処理を削除する。ブロックの発話はブロック読み込みでだけ返す。ブロック・映像区間のID、順序、時間範囲は維持する。

保存commandはproject全体DTOに依存させず、対象ID、必要なmetadata、結果、revisionを受け取る。既存commandのトランザクションとrevision検査は維持する。requestを作るTypeScript側はloaded記事の直接の値を使用する。

### 4.3 保存形式と既存データ

SQLiteのテーブル構造、assetのディレクトリ、PROJECT_VERSIONは維持する。今回の中心はIPCと画面のデータ契約であり、projectデータの初期化は不要。

タイトルの永続正本を`articles.title`に統一するため、新しいSQLite migrationで`documents.article_json`内の旧titleを除去する。過去のmigrationは編集しない。null原稿は維持し、壊れたJSONを空の原稿へ置き換えない。記事タイトルを含む過去の生成runや翻訳結果は書き換えない。

原稿の読み書きからtitleを外し、タイトル編集commandから原稿JSONの変更とdocument revisionの更新を外す。project/article revisionは更新する。これに伴うresponse型とrevision反映も変更する。

原稿JSONの他のキーは維持する。古いproject JSONの互換読み込みや、旧`MediaProject`を生成する恒久adapterは追加しない。

## 5. 更新と保存

### 5.1 純粋更新

`project.ts`の機能を分ける。

- `project.ts`: 空project、project名、動画・entryの追加削除。
- `article.ts`: 記事の設定、解析結果、本文、原稿、workflowの純粋更新。
- `articleSelectors.ts`: active article、metadata、source context、block viewsの取得。

記事更新は`updateArticleDraft(article, draft): Article`など、Articleを受け取ってArticleを返す。変更がなければ同じ参照を返す。無効な対象やIDは例外とし、保存成功や無変更と混同しない。

本文と発話はblocksだけを更新する。OCRはvisualSegmentsだけを更新する。再検出時はvisualSegmentsとblocksの対応を作り直し、後続処理の無効化規則を現在の実装から移す。元の文字起こし、ブロックへの割り当て、境界計画の役割を混ぜない。

日時は操作開始時に一度作り、純粋更新へ渡す。記事内容を変更する操作ではarticleとprojectのupdatedAtを更新し、最終訪問だけの操作は現行の日時契約を保つ。

### 5.2 操作の順序

`createProjectWorkspace`の操作キューを維持する。

1. 呼出し時に保持したprojectId/articleIdを、実行開始時のstateと照合する。
2. loaded entryのarticleを取り出す。
3. 純粋更新でnextArticleを計算する。無変更ならDBを呼ばない。
4. 必要な保存requestをnextArticleから作り、revision付きで保存する。
5. 成功後にそのentryをnextArticleへ置き換え、必要なproject metadataを更新する。
6. Reactへ新しいstateを公開する。

記事からproject直下へ展開する処理、project直下から記事へ書き戻す処理は不要。entryの置換はstateの正規の更新であり、別の編集コピーとの同期ではない。

保存失敗時はstateを更新しない。キューは次の操作を実行できる状態に戻す。ファイルの退避・復旧とDB revisionの扱いは保存層に残す。

### 5.3 workspaceの公開API

hookは`project`、派生した`activeArticle`、対象付きの名前付き操作を返す。setState、内部entryのMap、任意の更新関数を受けるpersist APIは公開しない。

`getArticleWorkspace(target)`は、現在の対象が一致するときだけ`{ project, article }`を返す。これは二つのstateのコピーではなく、最新stateから取得した参照。対象違いはnullとし、解析パイプライン側が明示的に停止する。

`ArticleTarget`はprojectId/articleIdを保持する。長時間処理のcallbackは処理開始時のtargetを保持し、結果受領時の選択記事へ付け替えない。内容変更の検査には既存の入力fingerprintを使う。

## 6. 画面、解析、エクスポート

### 6.1 ページとUI

project一覧・詳細はProjectとmetadata selectorを使う。記事ページはAppPagesで対象のloaded articleを確認し、Articleと必要なproject contextを渡す。

- Crop、スライド検出、文字起こし、OCR、記事レビュー、記事表示はArticleを主入力にする。
- 記事名は常にarticle.titleから読む。
- 記事切り替えUIはmetadataと選択IDを受ける。
- project名、動画一覧、記事一覧の概要はprojectから読む。
- 編集中の入力文字列、ダイアログ開閉、進捗は各UI/hookの一時状態として残す。

Appのrouteとnavigation request番号は維持する。ロード完了後も最新要求だけがrouteを変え、routeのproject/articleと読み込んだ対象が一致する場合だけ記事ページを描画する。

### 6.2 パイプライン

純粋な判定や入力組み立てはArticleまたは必要なフィールドのPickを受け取る。ffmpeg等にはsource contextと出力先を渡す。project名や記事一覧を、本文生成やOCRの入力に含めない。

assetの出力先に必要なprojectId/articleIdは実行contextへ明示する。文字起こし、OCR、本文、章、要約、翻訳の各実行入口とhookを新しい型へ移す。

boundary plan、本文、翻訳、エクスポートのfingerprintには、現在と同じ意味の入力値を渡す。型やフィールド名の変更だけで保存済み結果が無効になるような新しいversionは付けない。派生block viewの作成方法が変わっても、対象ID・テキスト・画像の意味は維持する。

### 6.3 エクスポート

exportDocumentの入力はarticle.title、article.document、blocks、visualSegments、source contextから作る。表示用に結合したblock viewはその場で生成する。

exportの入力keyも同じ正本から生成する。projectの改名や訪問時刻だけでは本文の生成済み判定・翻訳判定を変えない。現在の出力にproject名等が必要なら、その出力だけの入力keyに含める。

## 7. 読み込み、作成、削除

- 空project: entriesは空、activeArticleIdはnull。記事のない状態をUIで扱う。
- projectを開く: lastOpenedArticleIdがあればその詳細をロードし、なければmetadataだけロードする。
- 記事を開く: ロード結果の対象を検証し、旧loaded entryをmetadataへ落として新しいloaded entryを採用する。workflowを保存する操作と閲覧のみの操作を区別する。
- 記事を作る: 作成したArticleからloaded entryまたはmetadata entryを直接作る。先にprojectへ展開する処理は不要。Homeの初期記事作成はloadedにする。
- 記事を削除する: 成功後に再読込してentriesとrevisionを合わせる。削除対象が選択中ならactiveArticleIdを再読込結果に合わせる。
- 動画を削除する: 参照制約とasset補償処理を維持する。
- projectを削除する: 成功後にworkspaceをclearする。
- 復旧・古いassetの整理: project全体の編集DTOではなく、対象Articleと必要なIDを使う。未読込の記事の空配列から不要assetを判定しない。

## 8. 実装順序

一つの変更として完了させるが、作業中は次の順で移す。

1. ArticleMetadata、entry、Project、ArticleDocument、BlockTranscript、BlockViewとselectorを追加し、不変条件のテストを作る。
2. Rustの読み込みDTO、read transaction、タイトルmigrationとタイトル保存commandを変更し、Zod・storageの戻り値を合わせる。
3. 記事の純粋更新とarticleOperationsをArticle主体へ移す。ブロック本文のsegmentへの書き戻しを削除する。
4. projectOperations、createProjectWorkspace、useProjectWorkspaceを新しいstateに移す。作成・削除・再読込も移す。
5. 各ページ、解析hook、処理関数、export、asset cleanupを移す。fixtureも新しい正本へ合わせる。
6. 旧MediaProject、旧ArticleWorkspace、syncActiveArticle、activateArticle、articleToWorkspace、workspaceFor、projectWithArticleと旧フィールドのadapterを削除する。
7. 設計ガイド・SQLite設計・READMEの状態説明を更新し、全チェックと操作確認を行う。

途中だけ型変換adapterを使う場合も、この変更の完了前に削除する。Rustとフロントは同時に配布するため、旧IPC契約を残す必要はない。

## 9. 検証と完了条件

### 自動検証

- metadata/loadedが同じIDで重複するpayload、対象ID違い、不正な所属動画を拒否する。
- activeArticle selectorがloaded entryと同一参照を返す。未読込entryを詳細として扱えない。
- 記事タイトル変更で一覧、レビュー、表示、exportが同じtitleを使い、documentにtitleを保存しない。
- 本文・発話編集はblocksだけを更新し、block viewへ反映される。OCR編集は対応する映像区間へ反映される。
- 記事操作の保存失敗・競合ではstate/revisionが不変。無変更はIPCなし。失敗後も次の操作が進む。
- キュー待ち・解析中の記事切り替えで古い結果を拒否する。異なるprojectでも拒否する。
- read transaction内で詳細とrevisionが同じsnapshotになる。明示対象がlastOpenedArticleIdと違っても正しい記事とrevisionを返す。
- タイトルmigration後も本文、章、要約、翻訳を保持し、null原稿と壊れたJSONの扱いを変えない。
- 保存・再読込でcrop、範囲、OCR、発話、本文、境界計画、章、要約、翻訳、workflowを保持する。
- source contextと記事範囲の再生offsetを維持する。複数の映像区間が一ブロックになる場合、画像のない場合も検証する。
- 同じ内容の旧fixtureと新fixtureでfingerprintと各形式のexport結果が同じになる。

実装時はTypeScript型検査、変更ファイルの整形、lint、Bunテスト、Rust DBテスト、ビルド、React Doctorを実行する。既存の全体テスト失敗はbaselineと比較する。分類ロジック等の無関係な変更で件数だけを減らさない。

### アプリの操作確認

空project作成、動画追加、範囲から複数記事作成、記事切り替え、crop変更、解析、本文/タイトル編集、翻訳、export、再起動後の再開、選択記事と非選択記事の削除を確認する。保存中に別の画面へ移動した場合の対象一致も確認する。

### 完了条件

- 画面状態に同じ記事詳細の二つ目の保存先がない。
- 編集結果を別コピーへ同期する関数がない。
- 未読込と空の解析結果が型で区別できる。
- タイトルとブロック本文の正本が一箇所に決まっている。
- projectの空状態を仮のsource/workflowで表現していない。
- 旧MediaProject等と展開adapterへの参照がsrc/testsに残っていない。
- DBの既存projectとassetを初期化せず読み込み、更新、再開できる。

## 10. 実装後の構成

- `lib/project/article.ts`: 記事の純粋更新。`lib/project/articleOperations.ts`: 更新結果の保存。
- `lib/project/articleSelectors.ts`: loaded entryの参照と一覧用metadataの導出。
- `schemas/project.ts`: metadata/loaded・参照先・読み込み対象・revision payloadの検証。
- `createProjectWorkspace`: Projectのみを保持し、保存に成功した記事を対応entryへ置換する。
- `db_load_project`: 同一read transactionで記事とrevisionを取得する。
- migration `0007`: 原稿JSONの旧titleだけを除去する。PROJECT_VERSIONとasset配置は変更しない。

`ArticleContext`はprojectとarticleへの明示的な参照を処理関数へ渡すための型であり、記事フィールドをproject直下へ展開しない。`SlideData`は映像区間の既存UI名として残すが、transcriptは持たない。`ArticleBlockView`は表示・生成時に組み立てる読み取り専用の型で、保存対象にしない。

### 実装時の検証記録（2026-10-06）

- TypeScript本体・テストの型検査、変更ファイルの整形、Rust整形、setup、build、lint、diffチェックを実施。lintには既存の警告3件が残る。
- Bun: 88成功、4失敗。失敗は変更前にも存在したvisual-classificationの4ケース。今回の状態移行・workspace・本文生成・再生offsetのテストは成功。
- Rust: 11成功。作成・読み込み、明示対象とrevision、metadataとloadedの区別、空project、所属検証、タイトル更新のrollback、migrationの内容保持を確認。
- 旧実装との比較: 通常、複数映像区間を一ブロックに統合、画像なし、翻訳付きの4ケースで、生成入力・fingerprint・HTML/PDF用HTML/Markdown/TXTを比較し一致。
- React Doctor: 83/100、警告2件。AppPagesの分岐数とArticleThumbnailのcomponent以外のexport。
- 全体fmtチェックには、今回変更していないarticles-tab-design.mdとproject-list-progress-fix-design.mdの既存不整形が残る。変更ファイルはすべて整形済み。
- 実アプリでの全工程の手動操作と、実モデルを使用する解析・翻訳の通し実行は未実施。上記は自動検証の結果。
