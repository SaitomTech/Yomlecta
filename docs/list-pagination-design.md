# プロジェクト・記事一覧のページネーション

2026-09-23。実装内容と一覧APIの契約。

## 方式

一覧APIはcursor/keyset方式、画面は「前へ／次へ」で移動する。任意ページへのジャンプは設けない。データの追加・削除でoffset位置がずれにくく、画面側に過去のtokenを保持すれば前のページにも戻れる。

ページサイズは一覧画面が20件、ホームが5件。APIは1〜100件を受け付ける。検索と記事状態の絞り込みはDB側で行い、`total` は絞り込み後の件数とする。

## API

```ts
type PageInfo = {
  pageSize: number
  total: number
  hasNextPage: boolean
}

type PagedResult<T> = {
  items: T[]
  pageInfo: PageInfo
  nextPageToken: string | null
}
```

`db_list_projects` は `pageSize`、`pageToken`、`query` を受け取り、`ProjectListEntry` のページを返す。`db_list_articles` は同じ引数に記事名・プロジェクト名の `query` と状態 `status` を加え、`ArticleListItem` のページを返す。tokenは一覧種別・検索条件・状態フィルター・最後に返した行のソート値とIDに結び付け、条件が変わったtokenは拒否する。

## 検索・並び順

- プロジェクト: タイトルを検索し、`lastOpenedAt DESC, id ASC`。`lastOpenedAt` は選択中の記事のworkflow値を使い、値がなければプロジェクトの `updated_at` に戻す。summaryの従来の並び順を維持する。
- 記事: 記事名とプロジェクト名を検索し、`created_at DESC, id DESC`。状態はworkflowから導出し、一覧DTOに含める。
- 両方ともIDを最後のキーにして、同時刻の行も順序を固定する。
- ホームは同じAPIを5件で呼び、一覧全件を取得してから切り詰めない。

SQLiteには記事の作成日時順を支える `idx_articles_created_id` を追加する。プロジェクト一覧はsummaryと同じ最終閲覧順を保つため、`updated_at` の索引だけでは代用しない。タイトルの部分一致検索はB-tree索引を使いにくいため、まず単純な `instr(lower(...), lower(?))` を使う。

## 画面

プロジェクト一覧・記事一覧は20件ずつ表示し、共通の `Pagination` で件数範囲、現在ページ、前へ・次へを示す。ページ番号ボタンは設けない。前へ移動するためのtoken履歴は一覧画面が持ち、検索や状態フィルターが変わると先頭から取り直す。検索入力は250ms debounceする。

取得中はページ操作を無効にする。古いレスポンスが新しい条件を上書きしないよう、共通hookでリクエストを識別する。取得失敗は空状態と区別し、再読み込みを出す。ホームにはページネーションを置かず、最新5件だけ取得する。
