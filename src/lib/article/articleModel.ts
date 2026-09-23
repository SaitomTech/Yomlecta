import { getTextModel, TEXT_MODELS, type TextModel, type TextModelId } from '../llama/textModel'

export const OPENAI_LUNA_MODEL = {
  id: 'openai:gpt-6-luna',
  provider: 'openai',
  apiModel: 'gpt-6-luna',
  label: 'GPT-6 Luna',
  description: 'OpenAI APIを使う高速・低コストなクラウドモデルです。',
  reasoningEffort: 'none',
} as const

export const APPLE_FOUNDATION_MODELS = {
  id: 'apple:foundation-models',
  provider: 'apple',
  label: 'Apple Foundation Models',
  description:
    'macOS標準のオンデバイス文章生成です。文字起こしの整形とSlide本文の生成をMac内で行います。',
} as const

export type OpenAiArticleModel = typeof OPENAI_LUNA_MODEL
export type ArticleModel =
  | { provider: 'local'; id: TextModelId; model: TextModel }
  | typeof APPLE_FOUNDATION_MODELS
  | OpenAiArticleModel
export type ArticleModelId =
  | TextModelId
  | OpenAiArticleModel['id']
  | typeof APPLE_FOUNDATION_MODELS.id

export const DEFAULT_ARTICLE_MODEL_ID: ArticleModelId = OPENAI_LUNA_MODEL.id

export const ARTICLE_MODELS: readonly ArticleModel[] = [
  APPLE_FOUNDATION_MODELS,
  ...TEXT_MODELS.map((model) => ({ provider: 'local' as const, id: model.id, model })),
  OPENAI_LUNA_MODEL,
]

export function getArticleModel(id: string | undefined): ArticleModel {
  if (id === undefined) return OPENAI_LUNA_MODEL
  if (id === 'openai:gpt-5.6-luna') return OPENAI_LUNA_MODEL
  if (id === OPENAI_LUNA_MODEL.id) return OPENAI_LUNA_MODEL
  if (id === APPLE_FOUNDATION_MODELS.id) return APPLE_FOUNDATION_MODELS
  const model = getTextModel(id)
  return { provider: 'local', id: model.id, model }
}
