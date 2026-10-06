<p align="center">
  <img src="public/yomlecta-logo.png" alt="Yomlecta" width="420">
</p>

PowerPointやKeynoteなどのスライドを画面に投影した講演・講義動画を、**スライドごとの画像と、そのスライドで話された内容を読める記事**に変換するmacOSアプリです。

スライド範囲の検出、スライド切り替わりの検出、OCR、文字起こし、表記補正、記事本文の生成を、ローカルモデルやmacOS標準機能、OpenAI APIなどを組み合わせて行います。

現在はmacOS Apple Silicon（arm64）を対象にしています。Apple SpeechおよびApple Foundation Modelsを使う機能はmacOS 26以降が必要です。

## できること

- ローカル動画またはYouTube動画の読み込み
- スライド範囲・切り替わりの検出
- スライド画像のOCRと音声の文字起こし
- OCRを使った用語・固有名詞の表記補正
- スライドごとの記事本文の生成
- Markdown・HTML・TXTへのエクスポート
- ローカルモデル、macOS標準機能、OpenAI APIの選択

## 共通事項

### 動作環境

- Apple Silicon搭載Mac（現在の配布物はarm64版のみ）
- macOS 26以降（Apple Speech / Foundation Modelsを利用する場合）
- ローカルモデルを使う場合は、初回ダウンロード用のインターネット接続
- OpenAI APIを使う場合は、APIへ接続できるインターネット環境

### OpenAI APIの利用

OpenAIの機能を使う場合は、アプリ内に自分のOpenAI APIキーを入力します。キーはmacOS Keychainに保存され、リポジトリやGitHub Actionsには保存しません。OpenAI APIの利用料金は入力したAPIキーのアカウントに発生します。

OpenAIを選択した処理では、選択した音声・画像・文字起こし・本文データがOpenAI APIへ送信されます。ローカルモデルとApple標準モデルのデータ処理、送信先の詳細は[プライバシーとデータ取り扱い](./docs/プライバシー.md)を確認してください。

### モデルとダウンロード

ローカルモデルは初回利用時にHugging Faceからダウンロードされ、アプリのローカルデータ領域に保存されます。モデルファイルはこのリポジトリやDMGには含めていません。取得元、バージョン、ハッシュ、ライセンスは[Third-party notices](./THIRD_PARTY_NOTICES.md)にまとめています。

## 利用者向け

### DMGから使う

[Releases](https://github.com/SaitomTech/Yomlecta/releases)からDMGをダウンロードし、アプリを`Applications`へ移動して起動してください。

DMGからインストールして使う場合、Bun・Rust toolchain・Xcode Command Line Toolsは不要です。

Apple Developer Program未使用の未署名アプリのため、初回起動時にmacOSの確認が表示される場合があります。信頼できるGitHub Releaseからダウンロードした場合に限り、次の手順で起動してください。

1. DMGからアプリを`Applications`へ移動します。
2. Finderの`Applications`フォルダで`Yomlecta`をControlクリック（または右クリック）し、「開く」を選びます。
3. 確認ダイアログが表示されたら、もう一度「開く」を選びます。

「開く」が表示されない場合は、いったんアプリをダブルクリックして警告を表示したあと、システム設定の「プライバシーとセキュリティ」を開き、「セキュリティ」欄の「このまま開く」を選んでください。その後、確認ダイアログで「開く」を選びます。許可したアプリは、次回から通常どおり起動できます。

この初回許可は、アプリ内Updater経由で更新する限り、バージョンアップのたびに繰り返す必要はありません。手動で新しいDMGをダウンロードして入れ直す場合は、macOSが再度確認を表示することがあります。

#### ターミナルで許可する場合

GUI操作の代わりに、信頼できるGitHub Releaseからダウンロードしたアプリに限り、次のコマンドでも許可できます。

```bash
xattr -dr com.apple.quarantine "/Applications/Yomlecta.app"
open "/Applications/Yomlecta.app"
```

アプリを`Applications`以外に置いた場合は、パスを実際の`.app`の場所に置き換えてください。

## 開発者向け

### 開発環境

- [Bun](https://bun.sh/)
- Rust toolchain
- Xcode Command Line Tools（Swiftのsidecarをビルドするため）

### 開発環境のセットアップ

```bash
bun install --frozen-lockfile
bun run setup
bun tauri dev
```

`bun run setup`またはビルド時に、macOS arm64用のsidecarを取得・ビルドします。初回は外部バイナリのダウンロードに時間がかかることがあります。

### ローカルビルド

```bash
bun run build
bunx tauri build --bundles dmg
```

生成物は`src-tauri/target/release/bundle/`以下に作成されます。現在の配布物はApple Silicon用DMGのみです。

### 開発中のプロジェクトデータ

プロジェクトの保存先はTauriのAppLocalData配下の`library/library.sqlite`、動画や解析ファイルは`projects/`です。SQLiteの変更はmigrationで適用します。記事状態統一のmigrationは原稿JSONの旧titleのみを除去し、既存の本文・章・要約・翻訳を保持します。ストレージレイアウトやPROJECT_VERSIONは今回変更しません。

画面はProjectの記事entryにmetadataまたは読み込み済みArticleを保持します。選択記事はentryの参照で、同期用の複製stateは持ちません。詳しくは[記事状態の正本統一設計](./docs/article-state-single-source-design.md)を参照してください。

プロジェクトの追加・削除中に残った一時ファイルは、次回起動時に`.tmp`、`.bak`、`.trash`、`project-trash`から回収します。初期化や回収に失敗した場合は処理を継続せず、エラーを確認してから再試行してください。

## リリース

通常の開発とバージョン更新は`develop`で行います。`develop`から`main`へマージされたコミットにリリースタグを作成すると、リリースが開始します。`main`では直接開発せず、タグの作成・pushにだけ使用します。タグをpushしたら、ローカルの作業ブランチを`develop`へ戻します。タグはGitHub Desktopまたはコマンドラインから作成・pushします。Release画面からタグとReleaseを同時に公開する操作は、ビルド前にReleaseが公開されるため使用しません。

バージョンは`package.json`を基準に、関連するTauri/Cargoのマニフェストへ一括反映します。

```bash
bun run version:set 0.10.2
bun run version:check
```

```bash
git switch develop
git pull --ff-only origin develop
# バージョン更新をコミットしてdevelopへpushし、develop → mainのPRをマージする
git fetch origin main
git switch main
git pull --ff-only origin main
git tag --list vX.Y.Z
git ls-remote --tags origin vX.Y.Z
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
git switch develop
```

GitHub Actionsはタグのコミットが`main`の履歴に含まれているかを確認します。`develop`にしかない未マージのコミットを指定した場合はビルドを開始せず失敗します。

その後、DMGとアプリ内Updater用の更新パッケージをビルドしてDraft Releaseへ添付します。Release notesはGitHubの自動生成機能で下書きされます。ビルドが成功したら、Release notes、DMG、`latest.json`、更新パッケージを確認・編集してから手動でReleaseを公開します。ビルド中や失敗時のDraft Releaseは、アプリ内の更新確認からは見えません。

アプリ内の更新確認はGitHub Releaseの`latest.json`を参照し、見つかった更新をアプリ内でダウンロード・インストールして再起動できます。「更新を自動確認」を有効にすると、アプリ起動時にも更新を確認します。更新を見つけても作業中に再起動せず、表示された「インストール」ボタンから適用できます。更新パッケージの署名にはTauri Updater用の鍵を使います。これはAppleのDeveloper IDとは別の鍵なので、Apple Developer Programへの加入は必要ありません。

Release workflowで更新パッケージに署名するため、GitHubリポジトリのActions secretsに`TAURI_SIGNING_PRIVATE_KEY`を登録してください。パスワード付きの鍵を使う場合は`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`も登録します。秘密鍵はリポジトリへコミットしないでください。

## ライセンス

このプロジェクトのコードはMIT Licenseです。外部ライブラリ、sidecar、AIモデル、アイコンなどにはそれぞれのライセンスが適用されます。配布物には[Third-party notices](./THIRD_PARTY_NOTICES.md)と`LICENSE`を同梱しています。DMG内ではアプリの`Contents/Resources`に入り、アプリ上部の「ライセンス」からも表示できます。
