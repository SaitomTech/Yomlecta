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
