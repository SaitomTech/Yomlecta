import type { ArticleOutputLanguage, ArticleTranslation, MediaProject } from '../../types/project'
import { articleTranslationInputFingerprint, normalizeLanguage } from './translation'

const currentTranslationsCache = new WeakMap<MediaProject, ArticleTranslation[]>()

export function getCurrentArticleTranslations(project: MediaProject) {
  const cached = currentTranslationsCache.get(project)
  if (cached) return cached

  const translations = Object.values(project.article?.translations ?? {})
    .filter(
      (translation) =>
        translation.sourceLanguage !== translation.targetLanguage &&
        translation.inputFingerprint ===
          articleTranslationInputFingerprint(
            project,
            translation.sourceLanguage,
            translation.targetLanguage,
          ),
    )
    .sort((first, second) => second.generatedAt.localeCompare(first.generatedAt))
  currentTranslationsCache.set(project, translations)
  return translations
}

export function getCurrentJapaneseEnglishTranslation(project: MediaProject) {
  return getCurrentArticleTranslations(project).find(
    (translation) =>
      ['ja', 'en'].includes(translation.sourceLanguage) &&
      ['ja', 'en'].includes(translation.targetLanguage),
  )
}

export function getCurrentTranslationForOutputLanguage(
  project: MediaProject,
  language: ArticleOutputLanguage,
) {
  if (language === 'both') return getCurrentJapaneseEnglishTranslation(project)
  return getCurrentArticleTranslations(project).find(
    (translation) => translation.targetLanguage === language,
  )
}

export function getArticleSourceLanguage(project: MediaProject, translation?: ArticleTranslation) {
  return translation?.sourceLanguage ?? normalizeLanguage(project.transcription?.language) ?? 'ja'
}

export function isArticleOutputLanguageAvailable(
  project: MediaProject,
  language: ArticleOutputLanguage,
  translation = getCurrentJapaneseEnglishTranslation(project),
) {
  if (language === 'both') return Boolean(translation)
  const sourceLanguage = getArticleSourceLanguage(project, translation)
  return (
    sourceLanguage === language ||
    getCurrentArticleTranslations(project).some(
      (candidate) => candidate.targetLanguage === language,
    )
  )
}

export function getArticleOutputLanguage(project: MediaProject): ArticleOutputLanguage {
  const currentTranslations = getCurrentArticleTranslations(project)
  const storedLanguage = project.article?.outputLanguage
  const translation = currentTranslations.find(
    (candidate) =>
      ['ja', 'en'].includes(candidate.sourceLanguage) &&
      ['ja', 'en'].includes(candidate.targetLanguage),
  )
  if (storedLanguage) {
    if (storedLanguage === 'both' && translation) return storedLanguage
    const sourceLanguage = getArticleSourceLanguage(project, translation)
    if (
      sourceLanguage === storedLanguage ||
      currentTranslations.some((candidate) => candidate.targetLanguage === storedLanguage)
    ) {
      return storedLanguage
    }
  }
  if (translation) return 'both'
  const translatedLanguage = currentTranslations.find((candidate) =>
    ['ja', 'en'].includes(candidate.targetLanguage),
  )?.targetLanguage
  if (translatedLanguage === 'ja' || translatedLanguage === 'en') return translatedLanguage
  return getArticleSourceLanguage(project) === 'en' ? 'en' : 'ja'
}
