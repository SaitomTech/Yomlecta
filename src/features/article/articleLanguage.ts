import type { ArticleOutputLanguage, ArticleTranslationLanguage } from '../../types/project'

export const ARTICLE_LANGUAGES = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
] as const satisfies ReadonlyArray<{ id: ArticleTranslationLanguage; label: string }>

export const ARTICLE_OUTPUT_LANGUAGE_OPTIONS = [
  { value: 'ja', label: '日本語のみ' },
  { value: 'en', label: '英語のみ' },
  { value: 'both', label: '両方' },
] as const satisfies ReadonlyArray<{ value: ArticleOutputLanguage; label: string }>

export function articleLanguageLabel(language: string) {
  return ARTICLE_LANGUAGES.find((entry) => entry.id === language)?.label ?? language
}

export function normalizeArticleLanguage(value: string | undefined) {
  const normalized = value?.trim().replaceAll('_', '-').toLowerCase()
  if (!normalized) return undefined
  if (
    normalized === 'ja' ||
    normalized.startsWith('ja-') ||
    normalized === 'japanese' ||
    normalized === '日本語'
  )
    return 'ja' as const
  if (
    normalized === 'en' ||
    normalized.startsWith('en-') ||
    normalized === 'english' ||
    normalized === '英語'
  )
    return 'en' as const
  return undefined
}

function countMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length
}

export function inferArticleLanguage(sourceLanguage: string | undefined, sourceText = '') {
  const kanaCount = countMatches(sourceText, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu)
  const latinCount = countMatches(sourceText, /\p{Script=Latin}/gu)

  // Transcription metadata can be stale or wrong. Prefer a clear script signal from the
  // actual content the model will process, and use the detected audio language as fallback.
  if (kanaCount >= 6 && kanaCount / Math.max(1, latinCount) >= 0.08) return 'ja' as const
  if (latinCount >= 12 && kanaCount / latinCount < 0.04) return 'en' as const
  return normalizeArticleLanguage(sourceLanguage)
}

export function articleGenerationLanguageInstruction(
  sourceLanguage: string | undefined,
  sourceText = '',
) {
  const normalized = inferArticleLanguage(sourceLanguage, sourceText)
  if (normalized === 'en') {
    return 'OUTPUT LANGUAGE REQUIREMENT: Write all generated prose in English, matching the source text. Do not answer in Japanese or translate the source into Japanese. Keep names, technical terms, and quoted text in another language only when they appear that way in the source.'
  }
  if (normalized === 'ja') {
    return '元の言語は日本語です。出力も日本語にし、別の言語へ翻訳しないでください。固有名詞や引用内の他言語は原文どおり維持してください。'
  }
  return '出力には入力本文の主要言語をそのまま使用し、別の言語へ翻訳しないでください。入力内で複数言語が使い分けられている場合は、その使い分けも維持してください。'
}

export function resolveArticleLanguageVisibility({
  outputLanguage,
  sourceLanguage,
  targetLanguage,
  hasTranslation,
}: {
  outputLanguage: ArticleOutputLanguage
  sourceLanguage: string
  targetLanguage?: string
  hasTranslation: boolean
}) {
  const showTranslation = Boolean(
    hasTranslation &&
    targetLanguage &&
    (outputLanguage === 'both' || outputLanguage === targetLanguage),
  )
  const showSource =
    outputLanguage === 'both' || outputLanguage === sourceLanguage || !showTranslation
  const showLanguageLabels = outputLanguage === 'both'

  return {
    showSource,
    showTranslation,
    showSourceLanguageLabel: showLanguageLabels && showSource,
    showTargetLanguageLabel: showLanguageLabels && showTranslation,
    showTranslationDivider: showLanguageLabels && showSource && showTranslation,
  }
}
