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

export function articleGenerationLanguageInstruction(sourceLanguage: string | undefined) {
  const normalized = normalizeArticleLanguage(sourceLanguage)
  if (normalized === 'en') {
    return '元の言語は英語です。出力も必ず英語にし、日本語へ翻訳しないでください。固有名詞や引用内の他言語は原文どおり維持してください。'
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
