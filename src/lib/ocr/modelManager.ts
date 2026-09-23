import { ensureModelFiles, type ModelDownloadProgress } from '../models/download'

export const APPLE_VISION_OCR_MODEL = {
  id: 'apple-vision',
  provider: 'vision',
  label: 'Apple Vision',
  description: 'macOS標準のオンデバイスOCRです。追加モデルのダウンロードは不要です。',
  language: 'ja+en',
} as const

export const OPENAI_OCR_MODEL = {
  id: 'openai:gpt-6-luna',
  provider: 'openai',
  apiModel: 'gpt-6-luna',
  label: 'GPT-6 Luna',
  description: 'OpenAI APIの画像認識モデルです。スライド内の細かい文字を読み取ります。',
  prompt: [
    '画像内に実際に表示されている文字だけを、読み取った順序で抽出してください。',
    '要約、説明、推測、補完、翻訳はしないでください。',
    '判読できない文字は無理に補わず、読み取れた文字だけを返してください。',
    '返答は抽出した文字だけにしてください。Markdown、コードフェンス、前置きは不要です。',
  ].join('\n'),
} as const

const OCR_LOCAL_MODEL_DEFINITIONS = [
  {
    id: 'glm-ocr-q2_k',
    label: 'GLM-OCR Q2_K',
    description: 'Mac内で動作する軽量なローカルOCRモデルです。',
    totalSizeBytes: 845_760_288,
    directory: 'models/glm-ocr-q2',
    prompt: 'Text Recognition:',
    files: [
      {
        filename: 'GLM-OCR.Q2_K.gguf',
        url: 'https://huggingface.co/mradermacher/GLM-OCR-GGUF/resolve/3c1e642c0fa5df64831f0b04f3c674b57ce341af/GLM-OCR.Q2_K.gguf?download=true',
        sizeBytes: 361_356_608,
        sha256: '4ee505d13daca256655b53377cc1aa67600fd790d4956f79d4870c8c61ad0011',
      },
      {
        filename: 'GLM-OCR.mmproj-Q8_0.gguf',
        url: 'https://huggingface.co/mradermacher/GLM-OCR-GGUF/resolve/3c1e642c0fa5df64831f0b04f3c674b57ce341af/GLM-OCR.mmproj-Q8_0.gguf?download=true',
        sizeBytes: 484_403_680,
        sha256: 'fb3e1e89b862ed702a0a7b36b0bf6f5b6c6ab1579fc583ce13478c7c668b2088',
      },
    ],
  },
  {
    id: 'glm-ocr-q8_0',
    label: 'GLM-OCR Q8_0',
    description: 'Mac内で動作する高精度なローカルOCRモデルです。',
    totalSizeBytes: 1_434_837_056,
    directory: 'models/glm-ocr',
    prompt: 'Text Recognition:',
    files: [
      {
        filename: 'GLM-OCR-Q8_0.gguf',
        url: 'https://huggingface.co/ggml-org/GLM-OCR-GGUF/resolve/65a42de/GLM-OCR-Q8_0.gguf?download=true',
        sizeBytes: 950_433_408,
        sha256: '45bc244a6446aff850521dc41f18bc8d7105ad5f0c2c8c28af04e7cc4f4d50b1',
      },
      {
        filename: 'mmproj-GLM-OCR-Q8_0.gguf',
        url: 'https://huggingface.co/ggml-org/GLM-OCR-GGUF/resolve/65a42de/mmproj-GLM-OCR-Q8_0.gguf?download=true',
        sizeBytes: 484_403_648,
        sha256: '9c4b58e33e316ed142eb5dcb41abec3844d3e6e5dc361ffb782c3fa9d175141f',
      },
    ],
  },
  {
    id: 'paddleocr-vl-1.6',
    label: 'PaddleOCR-VL 1.6',
    description: 'Mac内で動作する多言語対応のローカルOCRモデルです。',
    totalSizeBytes: 1_817_539_616,
    directory: 'models/paddleocr-vl-1.6',
    prompt: 'OCR:',
    files: [
      {
        filename: 'PaddleOCR-VL-1.6-GGUF.gguf',
        url: 'https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/511b096/PaddleOCR-VL-1.6-GGUF.gguf?download=true',
        sizeBytes: 935_769_056,
        sha256: 'f3ae46ec885050acf4b3d31944431e1fd90d50664fb09126af4a3c050ba14ee8',
      },
      {
        filename: 'PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
        url: 'https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/511b096/PaddleOCR-VL-1.6-GGUF-mmproj.gguf?download=true',
        sizeBytes: 881_770_560,
        sha256: '204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a',
      },
    ],
  },
] as const

export type LocalOcrModelDefinition = (typeof OCR_LOCAL_MODEL_DEFINITIONS)[number]
export type LocalOcrModel = {
  provider: 'local'
  id: LocalOcrModelDefinition['id']
  label: LocalOcrModelDefinition['label']
  model: LocalOcrModelDefinition
}
export type OpenAiOcrModel = typeof OPENAI_OCR_MODEL
export type AppleVisionOcrModel = typeof APPLE_VISION_OCR_MODEL
export type OcrModel = LocalOcrModel | AppleVisionOcrModel | OpenAiOcrModel
export type OcrModelId = OcrModel['id']

export const OCR_LOCAL_MODELS: readonly LocalOcrModel[] = OCR_LOCAL_MODEL_DEFINITIONS.map(
  (model) => ({
    provider: 'local' as const,
    id: model.id,
    label: model.label,
    model,
  }),
)

export const OCR_MODELS: readonly OcrModel[] = [
  APPLE_VISION_OCR_MODEL,
  ...OCR_LOCAL_MODELS,
  OPENAI_OCR_MODEL,
]

export const DEFAULT_OCR_MODEL = APPLE_VISION_OCR_MODEL

export function getOcrModel(id: string | undefined) {
  return OCR_MODELS.find((model) => model.id === id) ?? DEFAULT_OCR_MODEL
}

export type OcrModelPaths = {
  modelPath: string
  mmprojPath: string
  contextSize: number
  skipChatParsing: true
}

export async function ensureOcrModel({
  modelId = DEFAULT_OCR_MODEL.id,
  onProgress,
  signal,
}: {
  modelId?: OcrModelId
  onProgress?: (progress: ModelDownloadProgress) => void
  signal?: AbortSignal
} = {}): Promise<OcrModelPaths> {
  const model = getOcrModel(modelId)
  if (model.provider !== 'local') {
    throw new Error('OpenAI OCRモデルにローカルモデルの準備処理は必要ありません。')
  }
  const [modelPath, mmprojPath] = await ensureModelFiles({
    directory: model.model.directory,
    files: model.model.files,
    onProgress,
    signal,
  })

  return { modelPath, mmprojPath, contextSize: 16_384, skipChatParsing: true }
}
