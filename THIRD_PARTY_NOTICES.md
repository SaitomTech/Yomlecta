# Third-party notices

Yomlecta 0.22.0 の macOS Apple Silicon 配布物で使用する、アプリ本体以外のソフトウェアとモデルを記載します。アプリ本体のコードにはリポジトリ直下の [MIT License](./LICENSE) が適用されますが、ここに記載する外部コンポーネントにはそれぞれのライセンスと追加条件が適用されます。

このファイルの確認日: 2026-09-25

## 配布物に含まれるsidecar

### FFmpeg / ffprobe

- バージョン: FFmpeg/ffprobe 9.0.1、Apple Silicon arm64、Martin Riedl build serverのRelease build
- 取得元: [FFmpeg ZIP](https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1/ffmpeg.zip)、[ffprobe ZIP](https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1/ffprobe.zip)
- SHA-256: `ffmpeg` = `8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe`、`ffprobe` = `102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a`
- ライセンス: `--enable-gpl` を含むビルド設定のため、FFmpeg部分はLGPL-onlyではなくGPL v2以降の条件が適用されます。さらに、組み込まれたコーデック・ライブラリには個別のライセンスがあります。[FFmpegの公式ライセンス説明](https://ffmpeg.org/legal.html)と[LICENSEの詳細](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)を確認してください。
- 対応ソースコード: [FFmpeg 9.0.1 source](https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz)、[Martin Riedlのbuild script](https://git.martin-riedl.de/ffmpeg/build-script)、[build server](https://ffmpeg.martin-riedl.de/)。この配布物の取得設定は [prepare-sidecars.ts](https://github.com/SaitomTech/Yomlecta/blob/develop/scripts/prepare-sidecars.ts)、ビルド設定は実体の `ffmpeg -buildconf` で確認できます。
- 著作権表示: Copyright (c) 2000-2026 the FFmpeg developers (`ffmpeg`)、Copyright (c) 2007-2026 the FFmpeg developers (`ffprobe`)

### whisper.cpp

- バージョン: OpenWhispr Binaries v1.0.0（macOS arm64）
- 取得元: [sjoerdteunisse/whisper.cpp v1.0.0](https://github.com/sjoerdteunisse/whisper.cpp/releases/tag/v1.0.0)
- SHA-256: `d033bd3f590cad50f39957bf86354f87b44394cb001e3f78a7b47264358103e3`
- ライセンス: [whisper.cpp MIT License](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
- 著作権表示: Copyright (c) 2023-2026 The ggml authors

### llama.cpp

- バージョン: `b10516`（`llama-server` と `llama-runtime` のdylib）
- 取得元: [llama.cpp b10516 release](https://github.com/ggml-org/llama.cpp/releases/tag/b10516)
- SHA-256: `ee3324327d621026ae80c24031670e65fa62a0b23a3a027dbe2f65f240affd30`（取得アーカイブ）
- ライセンス: [llama.cpp MIT License](https://github.com/ggml-org/llama.cpp/blob/b10516/LICENSE)
- 著作権表示: Copyright (c) 2023-2026 The ggml authors

### yt-dlp

- バージョン: `2026.08.19`（macOS arm64用 `yt-dlp_macos`）
- 取得元: [yt-dlp 2026.08.19 release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)
- SHA-256: `0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202`
- yt-dlp本体のライセンス: [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/LICENSE)
- PyInstaller実行ファイルに含まれる第三者コンポーネント: [yt-dlp 2026.08.19 THIRD_PARTY_LICENSES.txt](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/THIRD_PARTY_LICENSES.txt)。このファイルにはPythonなどのライセンスと、含まれるコンポーネントのソース取得先が記載されています。

### アプリ固有のhelper

- `apple-vision-ocr-aarch64-apple-darwin`: Yomlecta 0.22.0のビルド、ソースは [`src-tauri/vision-ocr/main.swift`](https://github.com/SaitomTech/Yomlecta/blob/develop/src-tauri/vision-ocr/main.swift)
- `apple-speech-transcriber-aarch64-apple-darwin`: Yomlecta 0.22.0のビルド、ソースは [`src-tauri/speech-transcriber/main.swift`](https://github.com/SaitomTech/Yomlecta/blob/develop/src-tauri/speech-transcriber/main.swift)
- `apple-foundation-models-aarch64-apple-darwin`: Yomlecta 0.22.0のビルド、ソースは [`src-tauri/foundation-models/main.swift`](https://github.com/SaitomTech/Yomlecta/blob/develop/src-tauri/foundation-models/main.swift)
- `apple-translator-aarch64-apple-darwin`: Yomlecta 0.22.0のビルド、ソースは [`src-tauri/apple-translator/main.swift`](https://github.com/SaitomTech/Yomlecta/blob/develop/src-tauri/apple-translator/main.swift)。macOS 26以降のTranslation frameworkを利用します。

上記はこのリポジトリのSwiftソースからビルドするアプリ固有のコードです。AppleのOS/API自体の条件はAppleの利用規約・SDKライセンスに従います。

## アプリが提供するモデル

モデルはDMGに同梱せず、初回利用時に下記の固定revisionからダウンロードします。各ファイルのSHA-256は [モデル定義](https://github.com/SaitomTech/Yomlecta/tree/develop/src/lib) にあるダウンロード検証値と一致します。

### Whisper系

取得元は [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1) のrevision `5359861c739e955e79d9a303bcbc70fb988958b1` です。モデルリポジトリの表示ライセンスはMITです。元の [OpenAI Whisper](https://github.com/openai/whisper) もMITです。

| モデル名                    | ファイル                       | SHA-256                                                            |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Whisper large-v3-turbo Q5_0 | `ggml-large-v3-turbo-q5_0.bin` | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |
| Whisper large-v3 Q5_0       | `ggml-large-v3-q5_0.bin`       | `d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1` |
| Whisper large-v3            | `ggml-large-v3.bin`            | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |
| Whisper large-v3-turbo      | `ggml-large-v3-turbo.bin`      | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` |
| Whisper large-v3-turbo Q8_0 | `ggml-large-v3-turbo-q8_0.bin` | `317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1` |
| Whisper medium Q5_0         | `ggml-medium-q5_0.bin`         | `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` |
| Whisper small Q5_1          | `ggml-small-q5_1.bin`          | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| Whisper base Q5_1           | `ggml-base-q5_1.bin`           | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |
| Whisper tiny Q5_1           | `ggml-tiny-q5_1.bin`           | `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7` |

#### Kotoba-Whisper

- モデル名: Kotoba-Whisper v2.0 Q5_0
- ファイル: `ggml-kotoba-whisper-v2.0-q5_0.bin`
- バージョン: `kotoba-tech/kotoba-whisper-v2.0-ggml` revision `e3a0cf6a62b95911703cfb97d819292e058f12c3`
- 取得元: [Hugging Face model repository](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/tree/e3a0cf6a62b95911703cfb97d819292e058f12c3)
- SHA-256: `4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658`
- ライセンス: Apache License 2.0

### Qwen系

いずれもQwen3のApache License 2.0です。量子化済みファイルの取得元とrevisionも固定しています。

| モデル名                    | ファイル                           | 取得元・revision                                                                                                                                               | SHA-256                                                            |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Qwen3 1.7B Q8_0             | `Qwen3-1.7B-Q8_0.gguf`             | [Qwen/Qwen3-1.7B-GGUF](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/tree/90862c4b9d2787eaed51d12237eafdfe7c5f6077) @ `90862c4b9d2787eaed51d12237eafdfe7c5f6077` | `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a` |
| Qwen3-4B-Instruct-2507 Q8_0 | `qwen3-4b-instruct-2507-q8_0.gguf` | [ggml-org/Qwen3-4B-Instruct-2507-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen3-4B-Instruct-2507-Q8_0-GGUF/tree/e6f794d) @ `e6f794d`                         | `ae916ede1c010a26955ee8ae2e908bf8815a3f135ec860439ab924701c69d5f1` |
| Qwen3 8B Q4_K_M             | `Qwen3-8B-Q4_K_M.gguf`             | [Qwen/Qwen3-8B-GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF/tree/7c41481) @ `7c41481`                                                                       | `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` |

### 翻訳モデル

- モデル名: LFM2-350M-ENJP-MT Q4_K_M
- ファイル: `LFM2-350M-ENJP-MT-Q4_K_M.gguf`（約229 MB）
- 取得元: [LiquidAI/LFM2-350M-ENJP-MT-GGUF](https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT-GGUF/tree/1a5bdb2d6e596656ed645a4088b9bb8f3423801c) revision `1a5bdb2d6e596656ed645a4088b9bb8f3423801c`
- SHA-256: `574ef7980dd20d69b494bce82565db5f25124d404be02052bbca62277d33077b`
- ライセンス: [LFM Open License v1.0](https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT-GGUF/blob/1a5bdb2d6e596656ed645a4088b9bb8f3423801c/LICENSE)
- 対応言語: 日本語と英語の双方向翻訳。モデルカード記載の推奨値（temperature 0.5、top_p 1.0、min_p 0.1、repetition_penalty 1.05）と翻訳方向を示す必須システムプロンプトを使用します。

### GLM-OCR

- モデル名: GLM-OCR Q2_K
- ファイル: `GLM-OCR.Q2_K.gguf`、`GLM-OCR.mmproj-Q8_0.gguf`
- 取得元: [mradermacher/GLM-OCR-GGUF](https://huggingface.co/mradermacher/GLM-OCR-GGUF/tree/3c1e642c0fa5df64831f0b04f3c674b57ce341af) @ `3c1e642c0fa5df64831f0b04f3c674b57ce341af`
- SHA-256: `GLM-OCR.Q2_K.gguf` = `4ee505d13daca256655b53377cc1aa67600fd790d4956f79d4870c8c61ad0011`、`GLM-OCR.mmproj-Q8_0.gguf` = `fb3e1e89b862ed702a0a7b36b0bf6f5b6c6ab1579fc583ce13478c7c668b2088`
- ライセンス: 量子化リポジトリの表示はMIT。[原モデル GLM-OCR](https://huggingface.co/zai-org/GLM-OCR) もMITです。

- モデル名: GLM-OCR Q8_0
- ファイル: `GLM-OCR-Q8_0.gguf`、`mmproj-GLM-OCR-Q8_0.gguf`
- 取得元: [ggml-org/GLM-OCR-GGUF](https://huggingface.co/ggml-org/GLM-OCR-GGUF/tree/65a42de) @ `65a42de`
- SHA-256: `GLM-OCR-Q8_0.gguf` = `45bc244a6446aff850521dc41f18bc8d7105ad5f0c2c8c28af04e7cc4f4d50b1`、`mmproj-GLM-OCR-Q8_0.gguf` = `9c4b58e33e316ed142eb5dcb41abec3844d3e6e5dc361ffb782c3fa9d175141f`
- ライセンス: 原モデル [GLM-OCR](https://huggingface.co/zai-org/GLM-OCR) のMIT。変換リポジトリには別のライセンス表示がないため、原モデルの条件に加えて取得元のREADMEも確認してください。

### PaddleOCR-VL

- モデル名: PaddleOCR-VL 1.6
- ファイル: `PaddleOCR-VL-1.6-GGUF.gguf`、`PaddleOCR-VL-1.6-GGUF-mmproj.gguf`
- バージョン: `PaddlePaddle/PaddleOCR-VL-1.6-GGUF` revision `511b096`
- 取得元: [Hugging Face model repository](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/tree/511b096)
- SHA-256: `PaddleOCR-VL-1.6-GGUF.gguf` = `f3ae46ec885050acf4b3d31944431e1fd90d50664fb09126af4a3c050ba14ee8`、`PaddleOCR-VL-1.6-GGUF-mmproj.gguf` = `204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a`
- ライセンス: Apache License 2.0（モデルリポジトリの表示）。

## アプリ本体のライセンス

アプリ本体のソースコードは [MIT License](./LICENSE) です。上記のFFmpeg、llama.cpp、whisper.cpp、yt-dlp、モデルなどはアプリ本体とは別の著作物であり、MIT Licenseへ一括変更されません。それぞれのライセンス、著作権表示、追加条件に従ってください。

このNOTICEはライセンスの法的助言ではありません。外部コンポーネントを追加・更新した場合は、取得元、revision、ハッシュ、ライセンス、著作権表示をこのファイルと配布物へ反映してください。
