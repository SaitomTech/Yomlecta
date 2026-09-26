import { ArrowDown, ArrowUp, PencilLine, Plus, Trash2 } from 'lucide-react'
import {
  DragOverlay,
  DragDropProvider,
  type DragEndEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
} from '@dnd-kit/react'
import { Fragment, useRef, useState } from 'react'
import { useVideoSourceUrl } from '../../../lib/media/useVideoSourceUrl'
import type {
  ArticleSection,
  ArticleSections,
  ArticleOutputLanguage,
  ArticleSummary,
  ArticleTranslation,
  MediaProject,
} from '../../../types/project'
import { useProjectTitleEditor } from '../../project/hooks/useProjectTitleEditor'
import { ArticleSectionEditor } from './ArticleSectionEditor'
import { ArticleSummaryResult } from './ArticleSummaryResult'
import { getArticleSourceLanguage, isArticleOutputLanguageAvailable } from '../outputLanguage'
import {
  ARTICLE_OUTPUT_LANGUAGE_OPTIONS,
  articleLanguageLabel,
  resolveArticleLanguageVisibility,
} from '../articleLanguage'

type ArticleReviewSectionGroup = {
  id: string
  slides: MediaProject['slides']
}

type ArticleStructureEditorProps = {
  project: MediaProject
  sections: ArticleSections
  sourcePath: string
  canEditSlide: boolean
  editingSlideId: string | null
  savedBodies: Record<string, string>
  bodyDraft: string
  isSavingBody: boolean
  isBodyDirty: boolean
  bodySaveError: string | null
  onStartSlideEditing: (slideId: string) => void
  onCancelSlideEditing: () => void
  onSaveSlide: () => void
  onBodyChange: (body: string) => void
  onSaveSections: (sections: ArticleSections | null) => void | Promise<void>
  summary?: ArticleSummary
  translation?: ArticleTranslation
  outputLanguage: ArticleOutputLanguage
  summaryIsUpToDate: boolean
  summaryDisabled?: boolean
  onSaveSummary: (summary: ArticleSummary) => void | Promise<void>
  onSaveOutputLanguage: (language: ArticleOutputLanguage) => void | Promise<void>
  disabled?: boolean
}

function articleSlidesFor(project: MediaProject) {
  return project.slides
    .filter((slide) => Boolean(slide.transcript))
    .sort((first, second) => first.index - second.index)
}

function cloneSections(sections: ArticleSections): ArticleSections {
  return {
    ...sections,
    sections: sections.sections.map((section) => ({
      ...section,
      slideIds: [...section.slideIds],
    })),
  }
}

function createSectionId() {
  return `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sortSlideIdsByProjectOrder(slideIds: string[], project: MediaProject) {
  const slideOrder = new Map(project.slides.map((slide) => [slide.id, slide.index]))
  return [...slideIds].sort(
    (first, second) =>
      (slideOrder.get(first) ?? Number.MAX_SAFE_INTEGER) -
      (slideOrder.get(second) ?? Number.MAX_SAFE_INTEGER),
  )
}

function normalizeSections(sections: ArticleSections, project: MediaProject): ArticleSections {
  const articleSlides = articleSlidesFor(project)
  const availableSlideIds = new Set(articleSlides.map((slide) => slide.id))
  const assignedSlideIds = new Set<string>()
  const normalized = sections.sections
    .map((section) => {
      const slideIds = sortSlideIdsByProjectOrder(section.slideIds, project).filter(
        (slideId) => availableSlideIds.has(slideId) && !assignedSlideIds.has(slideId),
      )
      slideIds.forEach((slideId) => assignedSlideIds.add(slideId))
      return { ...section, slideIds }
    })
    .filter((section) => section.slideIds.length > 0)

  return { ...sections, sections: normalized }
}

function sectionStartIndexes(sections: ArticleSections, project: MediaProject) {
  const slideIndexes = new Map(articleSlidesFor(project).map((slide, index) => [slide.id, index]))
  return sections.sections
    .map((section) => ({
      section,
      startIndex: Math.min(
        ...section.slideIds.map((slideId) => slideIndexes.get(slideId) ?? Number.MAX_SAFE_INTEGER),
      ),
    }))
    .filter(({ startIndex }) => Number.isFinite(startIndex))
    .sort((first, second) => first.startIndex - second.startIndex)
}

function moveSectionHeadingToGap(
  sections: ArticleSections,
  project: MediaProject,
  sourceId: string,
  targetGapIndex: number,
) {
  const articleSlides = articleSlidesFor(project)
  if (targetGapIndex < 0 || targetGapIndex >= articleSlides.length) return sections

  const entries = sectionStartIndexes(sections, project)
  const source = entries.find((entry) => entry.section.id === sourceId)
  if (!source || source.startIndex === targetGapIndex) return sections

  const target = entries.find((entry) => entry.startIndex === targetGapIndex)
  const nextEntries = entries.map((entry) => ({ ...entry }))
  if (target) {
    const sourceEntry = nextEntries.find((entry) => entry.section.id === sourceId)
    const targetEntry = nextEntries.find((entry) => entry.section.id === target.section.id)
    if (!sourceEntry || !targetEntry) return sections
    sourceEntry.startIndex = target.startIndex
    targetEntry.startIndex = source.startIndex
  } else {
    const sourceEntry = nextEntries.find((entry) => entry.section.id === sourceId)
    if (!sourceEntry) return sections
    sourceEntry.startIndex = targetGapIndex
  }

  return rebuildSectionsFromEntries(sections, project, nextEntries)
}

function rebuildSectionsFromEntries(
  sections: ArticleSections,
  project: MediaProject,
  entries: Array<{ section: ArticleSection; startIndex: number }>,
) {
  const orderedSlides = articleSlidesFor(project).map((slide) => slide.id)
  const orderedEntries = [...entries].sort((first, second) => first.startIndex - second.startIndex)
  return {
    ...sections,
    sections: orderedEntries.map((entry, index) => ({
      ...entry.section,
      slideIds: orderedSlides.slice(
        entry.startIndex,
        orderedEntries[index + 1]?.startIndex ?? orderedSlides.length,
      ),
    })),
  }
}

function moveSectionHeadingByStep(
  sections: ArticleSections,
  project: MediaProject,
  sectionId: string,
  offset: -1 | 1,
) {
  const entry = sectionStartIndexes(sections, project).find(
    (candidate) => candidate.section.id === sectionId,
  )
  if (!entry) return sections
  return moveSectionHeadingToGap(sections, project, sectionId, entry.startIndex + offset)
}

function getGroupsForSections(
  sections: ArticleSections,
  project: MediaProject,
): ArticleReviewSectionGroup[] {
  const sectionBySlideId = new Map(
    sections.sections.flatMap((section) =>
      section.slideIds.map((slideId) => [slideId, section] as const),
    ),
  )
  const groups: ArticleReviewSectionGroup[] = []
  let lastGroupKey: string | null = null
  let unassignedGroupIndex = 0

  articleSlidesFor(project).forEach((slide) => {
    const section = sectionBySlideId.get(slide.id)
    const groupKey = section?.id ?? '__unassigned__'
    if (groups.length === 0 || lastGroupKey !== groupKey) {
      groups.push({
        id: section?.id ?? `unassigned-${unassignedGroupIndex++}`,
        slides: [],
      })
      lastGroupKey = groupKey
    }
    groups.at(-1)?.slides.push(slide)
  })

  return groups
}

function SectionDragBehavior({
  sectionId,
  disabled,
  elementRef,
}: {
  sectionId: string
  disabled: boolean
  elementRef: React.RefObject<HTMLElement | null>
}) {
  useDraggable({
    id: `section-boundary-${sectionId}`,
    data: { type: 'section-boundary', sectionId },
    disabled,
    element: elementRef,
  })

  return null
}

function SectionHeadingEditor({
  section,
  index,
  disabled,
  onSave,
}: {
  section: ArticleSection
  index: number
  disabled: boolean
  onSave: (sectionId: string, heading: string) => Promise<void>
}) {
  const editor = useProjectTitleEditor({
    initialTitle: section.heading,
    onSave: (heading) => onSave(section.id, heading),
  })

  return editor.isEditing ? (
    <div className="max-w-[520px]">
      <input
        className="h-10 w-full rounded-[8px] border border-[#1d6b50] bg-[#f7faf7] px-3 text-[22px] font-bold tracking-[-0.05em] outline-none ring-2 ring-[#1d6b50]/10"
        value={editor.draft}
        onChange={(event) => editor.setDraft(event.target.value)}
        onKeyDown={editor.handleKeyDown}
        onCompositionStart={editor.handleCompositionStart}
        onCompositionEnd={editor.handleCompositionEnd}
        onBlur={editor.handleBlur}
        autoFocus
        disabled={disabled || editor.isSaving}
        aria-label={`セクション${index + 1}の見出し`}
      />
      {editor.error && <p className="mt-2 text-xs text-[#b6533a]">{editor.error}</p>}
    </div>
  ) : (
    <button
      className="group min-w-0 max-w-full rounded-[8px] px-1.5 py-0.5 text-left text-[22px] font-bold tracking-[-0.05em] transition hover:bg-[#eef3ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/20 disabled:cursor-not-allowed disabled:opacity-60"
      type="button"
      onClick={editor.startEditing}
      disabled={disabled || editor.isSaving}
      aria-label={`${section.heading}を編集`}
    >
      <span className="text-current">
        <span className="inline-block max-w-full truncate align-middle">{section.heading}</span>
        <PencilLine
          aria-hidden="true"
          className="pointer-events-none inline-block size-0 translate-x-[-0.25rem] overflow-hidden align-middle text-[#71807b] opacity-0 transition-[width,height,opacity,transform,margin] duration-200 group-hover:ml-1.5 group-hover:size-3.5 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:size-3.5 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          strokeWidth={2}
        />
      </span>
    </button>
  )
}

function SectionMoveGap({
  gapIndex,
  dragging,
  hideVisual = false,
  overlay = false,
}: {
  gapIndex: number
  dragging: boolean
  hideVisual?: boolean
  overlay?: boolean
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `section-gap-${gapIndex}`,
    data: { type: 'section-gap', gapIndex },
    disabled: !dragging || hideVisual,
  })

  return (
    <div
      ref={ref}
      className={`group flex items-center justify-center overflow-hidden transition-all ${overlay ? 'pointer-events-none absolute inset-x-0 -top-8 z-10 h-0' : 'relative'} ${dragging ? 'h-8 cursor-pointer touch-none opacity-100' : 'pointer-events-none h-0 opacity-0'} ${isDropTarget ? 'z-10' : ''}`}
    >
      <span
        className={`h-px w-full transition-colors ${hideVisual ? 'opacity-0' : isDropTarget ? 'bg-[#1d6b50]' : 'bg-[#a8c9b9]'}`}
        aria-hidden="true"
      />
      <span
        className={`absolute rounded-full border border-[#a8c9b9] bg-[#f7faf7] px-2 py-1 text-[10px] font-semibold text-[#1d6b50] shadow-[0_2px_6px_rgba(29,107,80,0.12)] transition ${hideVisual ? 'opacity-0' : isDropTarget ? 'opacity-100' : 'opacity-0'}`}
      >
        ここへ移動
      </span>
    </div>
  )
}

function SectionInsertGap({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="group relative flex h-8 items-center justify-center">
      <span
        className="h-px w-full bg-[#8bb6a2] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-hidden="true"
      />
      <button
        className="absolute left-1/2 top-1/2 inline-flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-[#a8c9b9] bg-[#f7faf7] px-2 text-[10px] font-semibold text-[#1d6b50] opacity-0 shadow-[0_2px_6px_rgba(29,107,80,0.12)] transition hover:bg-[#e2eee8] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 group-hover:opacity-100"
        type="button"
        onClick={onAdd}
        aria-label="この位置にセクションを追加"
        title="この位置にセクションを追加"
      >
        <Plus size={12} strokeWidth={2.1} />
        セクションを追加
      </button>
    </div>
  )
}

function SectionReviewHeader({
  section,
  index,
  totalSlides,
  globalStartIndex,
  disabled,
  translation,
  sourceLanguage,
  outputLanguage,
  onHeadingSave,
  onMoveByButton,
  onDelete,
}: {
  section: ArticleSection
  index: number
  totalSlides: number
  globalStartIndex: number
  disabled: boolean
  translation?: ArticleTranslation
  sourceLanguage: string
  outputLanguage: ArticleOutputLanguage
  onHeadingSave: (sectionId: string, heading: string) => Promise<void>
  onMoveByButton: (offset: -1 | 1) => void
  onDelete: () => void
}) {
  const headerRef = useRef<HTMLElement | null>(null)
  const translatedHeading = translation?.sections?.find((candidate) => candidate.id === section.id)
  const visibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage: translation?.targetLanguage,
    hasTranslation: Boolean(translatedHeading),
  })
  return (
    <header
      ref={headerRef}
      className={`flex min-h-[44px] min-w-0 items-center gap-3 rounded-none border-l-[10px] border-l-[#8bb6a2] bg-[#e8f2ec] px-2 py-0 transition-colors hover:bg-[#e2eee8] ${!disabled ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''}`}
    >
      <SectionDragBehavior sectionId={section.id} disabled={disabled} elementRef={headerRef} />
      <div className="min-w-0 flex-1">
        {visibility.showSource && (
          <>
            {visibility.showSourceLanguageLabel && (
              <p className="mb-0.5 px-1.5 text-[10px] font-semibold text-[#71807b]">
                {articleLanguageLabel(sourceLanguage)}
              </p>
            )}
            <SectionHeadingEditor
              section={section}
              index={index}
              disabled={disabled}
              onSave={onHeadingSave}
            />
          </>
        )}
        {visibility.showTranslation && translation && translatedHeading && (
          <div className={visibility.showSource ? 'mt-1.5' : ''}>
            {visibility.showTargetLanguageLabel && (
              <p className="mb-0.5 px-1.5 text-[10px] font-semibold text-[#71807b]">
                {articleLanguageLabel(translation.targetLanguage)}
              </p>
            )}
            <p className="px-2 py-1.5 text-[16px] font-semibold leading-6 text-[#33413c]">
              {translatedHeading.heading}
            </p>
          </div>
        )}
      </div>
      <button
        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[#d8e1dc] bg-[#fbfcfa] p-0 text-[#9aada3] transition hover:border-[#b7cbc0] hover:bg-[#e8f2ec] hover:text-[#1d6b50] disabled:opacity-30 disabled:hover:border-[#d8e1dc] disabled:hover:bg-[#fbfcfa] disabled:hover:text-[#9aada3] sm:inline-flex"
        type="button"
        onClick={() => onMoveByButton(-1)}
        disabled={globalStartIndex <= 0 || disabled}
        aria-label={`${section.heading}の境界を上へ移動`}
        title="境界を上へ移動"
      >
        <ArrowUp size={11} strokeWidth={2} />
      </button>
      <button
        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[#d8e1dc] bg-[#fbfcfa] p-0 text-[#9aada3] transition hover:border-[#b7cbc0] hover:bg-[#e8f2ec] hover:text-[#1d6b50] disabled:opacity-30 disabled:hover:border-[#d8e1dc] disabled:hover:bg-[#fbfcfa] disabled:hover:text-[#9aada3] sm:inline-flex"
        type="button"
        onClick={() => onMoveByButton(1)}
        disabled={globalStartIndex >= totalSlides - 1 || disabled}
        aria-label={`${section.heading}の境界を下へ移動`}
        title="境界を下へ移動"
      >
        <ArrowDown size={11} strokeWidth={2} />
      </button>
      <button
        className="shrink-0 rounded-[7px] p-2 text-[#9aada3] transition hover:bg-[#f8ebe7] hover:text-[#b6533a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30"
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`${section.heading}を削除（スライドは残ります）`}
        title="セクションを削除（スライドは残ります）"
      >
        <Trash2 size={15} strokeWidth={1.8} />
      </button>
    </header>
  )
}

type ReviewGroupSlidesProps = {
  group: ArticleReviewSectionGroup
  globalStartIndex: number
  isDragging: boolean
  disabled: boolean
  savedBodies: Record<string, string>
  editingSlideId: string | null
  bodyDraft: string
  translation?: ArticleTranslation
  sourceLanguage: string
  outputLanguage: ArticleOutputLanguage
  isSavingBody: boolean
  isBodyDirty: boolean
  bodySaveError: string | null
  videoSrc: string | null
  activeVideoSlideId: string | null
  canEditSlide: boolean
  onAddAtGap: (gapIndex: number) => void
  onStartSlideEditing: (slideId: string) => void
  onCancelSlideEditing: () => void
  onSaveSlide: () => void
  onBodyChange: (body: string) => void
  onVideoToggle: (slideId: string, open: boolean) => void
}

function ReviewGroupSlides(props: ReviewGroupSlidesProps) {
  return props.group.slides.map((slide, slideIndex) => {
    const isEditing = props.editingSlideId === slide.id
    const globalGapIndex = props.globalStartIndex + slideIndex
    return (
      <Fragment key={slide.id}>
        {slideIndex > 0 && (
          <>
            <SectionMoveGap gapIndex={globalGapIndex} dragging={props.isDragging} />
            {!props.isDragging && !props.disabled && (
              <SectionInsertGap onAdd={() => props.onAddAtGap(globalGapIndex)} />
            )}
          </>
        )}
        <ArticleSectionEditor
          slide={slide}
          videoSrc={props.videoSrc}
          videoOpen={props.activeVideoSlideId === slide.id}
          body={isEditing ? props.bodyDraft : (props.savedBodies[slide.id] ?? '')}
          sourceLanguage={props.sourceLanguage}
          outputLanguage={props.outputLanguage}
          translationBody={props.translation?.bodies[slide.id]}
          translationLanguage={props.translation?.targetLanguage}
          editing={isEditing}
          editDisabled={!isEditing && (!props.canEditSlide || props.disabled)}
          saving={props.isSavingBody && isEditing}
          canSave={props.isBodyDirty}
          error={isEditing ? props.bodySaveError : null}
          onEdit={() => props.onStartSlideEditing(slide.id)}
          onCancel={props.onCancelSlideEditing}
          onSave={props.onSaveSlide}
          onBodyChange={props.onBodyChange}
          onVideoToggle={(open) => props.onVideoToggle(slide.id, open)}
        />
      </Fragment>
    )
  })
}

function SectionReviewGroup({
  section,
  group,
  index,
  totalSlides,
  globalStartIndex,
  draggingSectionId,
  sectionControlsDisabled,
  savedBodies,
  editingSlideId,
  bodyDraft,
  translation,
  sourceLanguage,
  outputLanguage,
  isSavingBody,
  isBodyDirty,
  bodySaveError,
  videoSrc,
  activeVideoSlideId,
  canEditSlide,
  onHeadingSave,
  onMoveByButton,
  onAddAtGap,
  onDelete,
  onStartSlideEditing,
  onCancelSlideEditing,
  onSaveSlide,
  onBodyChange,
  onVideoToggle,
}: {
  section?: ArticleSection
  group: ArticleReviewSectionGroup
  index: number
  totalSlides: number
  globalStartIndex: number
  draggingSectionId: string | null
  sectionControlsDisabled: boolean
  savedBodies: Record<string, string>
  editingSlideId: string | null
  bodyDraft: string
  translation?: ArticleTranslation
  sourceLanguage: string
  outputLanguage: ArticleOutputLanguage
  isSavingBody: boolean
  isBodyDirty: boolean
  bodySaveError: string | null
  videoSrc: string | null
  activeVideoSlideId: string | null
  canEditSlide: boolean
  onHeadingSave: (sectionId: string, heading: string) => Promise<void>
  onMoveByButton: (offset: -1 | 1) => void
  onAddAtGap: (gapIndex: number) => void
  onDelete: () => void
  onStartSlideEditing: (slideId: string) => void
  onCancelSlideEditing: () => void
  onSaveSlide: () => void
  onBodyChange: (body: string) => void
  onVideoToggle: (slideId: string, open: boolean) => void
}) {
  const isDragging = draggingSectionId !== null
  return (
    <div className="relative">
      {section && (
        <SectionMoveGap
          gapIndex={globalStartIndex}
          dragging={isDragging}
          hideVisual={draggingSectionId === section.id}
          overlay
        />
      )}
      {!section && isDragging && (
        <SectionMoveGap gapIndex={globalStartIndex} dragging={isDragging} />
      )}
      {section && (
        <SectionReviewHeader
          section={section}
          index={index}
          totalSlides={totalSlides}
          globalStartIndex={globalStartIndex}
          disabled={sectionControlsDisabled}
          translation={translation}
          sourceLanguage={sourceLanguage}
          outputLanguage={outputLanguage}
          onHeadingSave={onHeadingSave}
          onMoveByButton={onMoveByButton}
          onDelete={onDelete}
        />
      )}

      <div className={section ? 'mt-4' : 'mt-0'}>
        {!section && globalStartIndex === 0 && !isDragging && !sectionControlsDisabled && (
          <SectionInsertGap onAdd={() => onAddAtGap(0)} />
        )}
        <ReviewGroupSlides
          group={group}
          globalStartIndex={globalStartIndex}
          isDragging={isDragging}
          disabled={sectionControlsDisabled}
          savedBodies={savedBodies}
          editingSlideId={editingSlideId}
          bodyDraft={bodyDraft}
          translation={translation}
          sourceLanguage={sourceLanguage}
          outputLanguage={outputLanguage}
          isSavingBody={isSavingBody}
          isBodyDirty={isBodyDirty}
          bodySaveError={bodySaveError}
          videoSrc={videoSrc}
          activeVideoSlideId={activeVideoSlideId}
          canEditSlide={canEditSlide}
          onAddAtGap={onAddAtGap}
          onStartSlideEditing={onStartSlideEditing}
          onCancelSlideEditing={onCancelSlideEditing}
          onSaveSlide={onSaveSlide}
          onBodyChange={onBodyChange}
          onVideoToggle={onVideoToggle}
        />
      </div>
    </div>
  )
}

function OutputLanguageSelector({
  project,
  translation,
  sourceLanguage,
  outputLanguage,
  disabled,
  canEditSlide,
  saving,
  error,
  onChange,
}: {
  project: MediaProject
  translation?: ArticleTranslation
  sourceLanguage: string
  outputLanguage: ArticleOutputLanguage
  disabled: boolean
  canEditSlide: boolean
  saving: boolean
  error: string | null
  onChange: (language: ArticleOutputLanguage) => void
}) {
  return (
    <fieldset className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
      <legend className="px-1 text-xs font-semibold text-[#18211f]">記事の出力言語</legend>
      <div className="flex flex-wrap gap-3">
        {ARTICLE_OUTPUT_LANGUAGE_OPTIONS.map((option) => {
          const language = option.value
          const available = isArticleOutputLanguageAvailable(project, language, translation)
          return (
            <label
              key={language}
              className={`inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-xs font-semibold ${available ? 'border-[#b7cbc0] bg-white text-[#33413c]' : 'border-[#e0e8e3] bg-[#f0f3f1] text-[#9aa6a1]'}`}
            >
              <input
                className="accent-[#1d6b50]"
                type="radio"
                name="article-output-language"
                value={language}
                checked={outputLanguage === language}
                onChange={() => onChange(language)}
                disabled={
                  disabled || !canEditSlide || saving || (!available && language !== outputLanguage)
                }
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {!translation && (
        <p className="mt-2 text-[10px] leading-5 text-[#71807b]">
          {sourceLanguage === 'en' ? '日本語のみ' : '英語のみ'}または「両方」を選ぶには、Step
          1で翻訳を生成してください。
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[#b6533a]">{error}</p>}
    </fieldset>
  )
}

function TranslatedArticleTitle({
  translation,
  outputLanguage,
}: {
  translation?: ArticleTranslation
  outputLanguage: ArticleOutputLanguage
}) {
  if (!translation || (outputLanguage !== 'both' && outputLanguage !== translation.targetLanguage))
    return null
  return (
    <div className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#fbfcfa] px-4 py-3">
      <p className="text-[10px] font-semibold text-[#71807b]">記事タイトルの訳文</p>
      {outputLanguage === 'both' && (
        <p className="mt-1 text-[10px] font-semibold text-[#71807b]">
          {articleLanguageLabel(translation.targetLanguage)}
        </p>
      )}
      <p className="mt-1 px-2 py-1.5 text-[16px] font-semibold leading-6 text-[#33413c]">
        {translation.title}
      </p>
    </div>
  )
}

export function ArticleStructureEditor({
  project,
  sections,
  sourcePath,
  canEditSlide,
  editingSlideId,
  savedBodies,
  bodyDraft,
  translation,
  outputLanguage,
  isSavingBody,
  isBodyDirty,
  bodySaveError,
  onStartSlideEditing,
  onCancelSlideEditing,
  onSaveSlide,
  onBodyChange,
  onSaveSections,
  summary,
  onSaveOutputLanguage,
  summaryIsUpToDate,
  summaryDisabled = false,
  onSaveSummary,
  disabled = false,
}: ArticleStructureEditorProps) {
  const videoSource = useVideoSourceUrl(sourcePath)
  const [activeVideoSlideId, setActiveVideoSlideId] = useState<string | null>(null)
  const [draftState, setDraftState] = useState<{
    version: string
    value: ArticleSections
  } | null>(null)
  const [isSavingSections, setIsSavingSections] = useState(false)
  const [sectionError, setSectionError] = useState<string | null>(null)
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null)
  const [isSavingOutputLanguage, setIsSavingOutputLanguage] = useState(false)
  const [outputLanguageError, setOutputLanguageError] = useState<string | null>(null)
  const sourceLanguage = getArticleSourceLanguage(project, translation)

  const sectionVersion = `${sections.model}:${sections.inputFingerprint}:${sections.generatedAt ?? ''}`
  const draft = draftState?.version === sectionVersion ? draftState.value : null
  const currentSections = draft ?? normalizeSections(cloneSections(sections), project)
  const displayGroups = getGroupsForSections(currentSections, project)
  const sectionById = new Map(currentSections.sections.map((section) => [section.id, section]))
  const slideOrder = new Map(articleSlidesFor(project).map((slide, index) => [slide.id, index]))

  const prepareSectionsForSave = (next: ArticleSections): ArticleSections => {
    const normalized = normalizeSections(next, project)
    return {
      ...normalized,
      sections: normalized.sections.map((section) => ({
        ...section,
        heading: section.heading.trim(),
        slideIds: sortSlideIdsByProjectOrder(section.slideIds, project),
      })),
    }
  }
  const persistSections = async (next: ArticleSections) => {
    const prepared = prepareSectionsForSave(next)
    setDraftState({ version: sectionVersion, value: prepared })
    setSectionError(null)
    setIsSavingSections(true)
    try {
      await onSaveSections(prepared.sections.length > 0 ? prepared : null)
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : 'セクションの保存に失敗しました。'
      setSectionError(message)
      throw error
    } finally {
      setIsSavingSections(false)
    }
  }
  const applySectionUpdate = (update: (current: ArticleSections) => ArticleSections) => {
    if (isSavingSections) return
    const next = update(currentSections)
    if (next === currentSections) return
    void persistSections(next).catch(() => undefined)
  }
  const addSectionAtGap = (gapIndex: number) => {
    applySectionUpdate((current) => {
      const articleSlides = articleSlidesFor(project)
      if (gapIndex < 0 || gapIndex >= articleSlides.length) return current

      const entries = sectionStartIndexes(current, project)
      if (entries.some((entry) => entry.startIndex === gapIndex)) return current

      const nextSection = {
        id: createSectionId(),
        heading: '新しいセクション',
        slideIds: [],
      }
      return rebuildSectionsFromEntries(current, project, [
        ...entries,
        { section: nextSection, startIndex: gapIndex },
      ])
    })
  }
  const deleteSection = (sectionId: string) => {
    applySectionUpdate((current) => {
      const sourceIndex = current.sections.findIndex((section) => section.id === sectionId)
      if (sourceIndex < 0) return current
      const source = current.sections[sourceIndex]
      if (sourceIndex === 0) {
        return {
          ...current,
          sections: current.sections.filter((section) => section.id !== source.id),
        }
      }

      return {
        ...current,
        sections: current.sections
          .map((section, index) =>
            index === sourceIndex - 1
              ? { ...section, slideIds: [...section.slideIds, ...source.slideIds] }
              : section,
          )
          .filter((section) => section.id !== sectionId),
      }
    })
  }
  const saveHeading = async (sectionId: string, heading: string) => {
    if (!heading.trim()) throw new Error('セクション見出しを入力してください。')
    await persistSections({
      ...currentSections,
      sections: currentSections.sections.map((section) =>
        section.id === sectionId ? { ...section, heading } : section,
      ),
    })
  }
  const handleDragStart = (event: DragStartEvent) => {
    const sectionId = event.operation.source?.data?.sectionId
    if (typeof sectionId === 'string') setDraggingSectionId(sectionId)
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const sourceSectionId = event.operation.source?.data?.sectionId
    const targetGapIndex = event.operation.target?.data?.gapIndex
    setDraggingSectionId(null)
    if (
      event.canceled ||
      typeof sourceSectionId !== 'string' ||
      typeof targetGapIndex !== 'number'
    ) {
      return
    }
    void persistSections(
      moveSectionHeadingToGap(currentSections, project, sourceSectionId, targetGapIndex),
    ).catch(() => undefined)
  }
  const handleOutputLanguageChange = async (language: ArticleOutputLanguage) => {
    if (isSavingOutputLanguage || language === outputLanguage) return
    setIsSavingOutputLanguage(true)
    setOutputLanguageError(null)
    try {
      await onSaveOutputLanguage(language)
    } catch (error) {
      console.error(error)
      setOutputLanguageError(
        error instanceof Error ? error.message : '表示言語の設定を保存できませんでした。',
      )
    } finally {
      setIsSavingOutputLanguage(false)
    }
  }
  const handleVideoToggle = (slideId: string, open: boolean) => {
    setActiveVideoSlideId((current) => (open ? slideId : current === slideId ? null : current))
  }
  return (
    <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="article-review-heading" className="text-[21px] font-bold tracking-[-0.05em]">
              2. 表示言語の設定・生成記事の確認と編集
            </h2>
            <p className="mt-1 text-xs text-[#71807b]">
              出力言語を選び、要約・見出し・各Slideの原文を編集できます。訳文は再翻訳で更新されます。
            </p>
          </div>
        </div>
        <OutputLanguageSelector
          project={project}
          translation={translation}
          sourceLanguage={sourceLanguage}
          outputLanguage={outputLanguage}
          disabled={disabled}
          canEditSlide={canEditSlide}
          saving={isSavingOutputLanguage}
          error={outputLanguageError}
          onChange={(language) => void handleOutputLanguageChange(language)}
        />
        <TranslatedArticleTitle translation={translation} outputLanguage={outputLanguage} />
        {sectionError && <p className="mt-3 text-xs text-[#b6533a]">{sectionError}</p>}

        <ArticleSummaryResult
          summary={summary}
          translation={translation}
          outputLanguage={outputLanguage}
          isUpToDate={summaryIsUpToDate}
          disabled={summaryDisabled}
          onSave={onSaveSummary}
        />

        <div className="mt-5 space-y-7">
          {displayGroups.length > 0 ? (
            displayGroups.map((group, index) => (
              <SectionReviewGroup
                key={group.id}
                section={sectionById.get(group.id)}
                group={group}
                index={index}
                totalSlides={articleSlidesFor(project).length}
                globalStartIndex={slideOrder.get(group.slides[0]?.id ?? '') ?? 0}
                draggingSectionId={draggingSectionId}
                sectionControlsDisabled={disabled || isSavingSections || !canEditSlide}
                savedBodies={savedBodies}
                editingSlideId={editingSlideId}
                bodyDraft={bodyDraft}
                translation={translation}
                sourceLanguage={sourceLanguage}
                outputLanguage={outputLanguage}
                isSavingBody={isSavingBody}
                isBodyDirty={isBodyDirty}
                bodySaveError={bodySaveError}
                videoSrc={videoSource.src}
                activeVideoSlideId={activeVideoSlideId}
                canEditSlide={canEditSlide}
                onHeadingSave={saveHeading}
                onMoveByButton={(offset) => {
                  applySectionUpdate((current) =>
                    moveSectionHeadingByStep(current, project, group.id, offset),
                  )
                }}
                onAddAtGap={(gapIndex) => addSectionAtGap(gapIndex)}
                onDelete={() => deleteSection(group.id)}
                onStartSlideEditing={onStartSlideEditing}
                onCancelSlideEditing={onCancelSlideEditing}
                onSaveSlide={onSaveSlide}
                onBodyChange={onBodyChange}
                onVideoToggle={handleVideoToggle}
              />
            ))
          ) : (
            <div className="border-y border-dashed border-[#b7cbc0] px-4 py-10 text-center text-xs text-[#71807b]">
              文字起こし済みの記事本文がありません。
            </div>
          )}
        </div>
      </div>
      <DragOverlay disabled={draggingSectionId === null} dropAnimation={null}>
        {draggingSectionId ? (
          <div className="flex min-h-[44px] items-center rounded-none border-l-[10px] border-l-[#8bb6a2] bg-[#e8f2ec] px-2 py-0 text-[22px] font-bold text-[#18211f] shadow-[0_8px_24px_rgba(24,33,31,0.16)]">
            <span>{sectionById.get(draggingSectionId)?.heading ?? 'セクション'}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DragDropProvider>
  )
}
