'use client';

import { useEffect, useRef, useState } from 'react';
import { displayEpubPath } from '../../lib/epub/epub-utils';
import JSZip from 'jszip';

import type {
  SectionTypeFix,
  CodeIssueDetail,
  EpubAnalysisResult,
  EpubMetadata,
  MetadataTextDetail,
  TocContentFix,
  TocContentIssue,
} from '../../types/epub';
import { analyzeEpub } from '../../lib/epub/analyze-epub';
import { previewEpubCss, cleanEpubCss, type CssCleanupPreview } from '../../lib/epub/clean-css';
import EpubMetadataSection from './epub-metadata';
import EpubMetadataCheck from './epub-metadata-check';
import EpubStructureCheck from './epub-structure-check';
import EpubLoiCheck from './epub-loi-check';
import EpubCodeResults from './epub-code-results';
import EpubCoverPdfCheck from './epub-cover-pdf-check';
import EpubTocContentResults from './epub-toc-content-results';
import EpubCssCleaner from './epub-css-cleaner';
import EpubFinalReport from './epub-final-report';
import EpubImageAssets from './epub-image-assets';

const CONTAINER_PATH = 'META-INF/container.xml';
const OPF_NS = 'http://www.idpf.org/2007/opf';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const ACCESSIBILITY_AA = 'EPUB Accessibility 1.1 - WCAG 2.2 Level AA';

interface ModifiedEpubResult {
  blob: Blob;
  accessibilityModified: boolean;
}

interface MetadataTextFix extends MetadataTextDetail {
  replacementText: string;
}

interface LoiFigureFix {
  xhtmlFile: string;
  id: string;
  originalCaption?: string;
  imagePath?: string;
  caption?: string;
  imageFile?: File;
}

type WorkflowStep =
  | 'metadata'
  | 'cover'
  | 'introduce'
  | 'backcover'
  | 'metadata-check'
  | 'structure'
  | 'loi'
  | 'toc'
  | 'code'
  | 'css'
  | 'download';

const WORKFLOW_STEPS: { id: WorkflowStep; label: string; path: string }[] = [
  { id: 'metadata', label: '메타데이터', path: '/metadata' },
  { id: 'cover', label: '커버', path: '/cover' },
  { id: 'introduce', label: '소개', path: '/introduce' },
  { id: 'backcover', label: '뒤표지', path: '/backcover' },
  { id: 'metadata-check', label: '메타데이터 검사', path: '/metadata-check' },
  { id: 'structure', label: '구조 및 언어', path: '/structure' },
  { id: 'loi', label: '이미지 목차', path: '/loi' },
  { id: 'toc', label: '목차', path: '/toc' },
  { id: 'code', label: '코드', path: '/code' },
  { id: 'css', label: 'CSS', path: '/css' },
  { id: 'download', label: '완료', path: '/download' },
];

function stepFromPath(pathname: string): WorkflowStep {
  return WORKFLOW_STEPS.find((step) => step.path === pathname)?.id ?? 'metadata';
}

export default function EpubUploader() {
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [uploadEpub, setUploadEpub] = useState<File | null>(null);
  const [uploadBodyPdf, setUploadBodyPdf] = useState<File | null>(null);
  const [uploadCoverPdf, setUploadCoverPdf] = useState<File | null>(null);
  const codeFixLockRef = useRef(false);
  const tocFixLockRef = useRef(false);

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<EpubAnalysisResult | null>(null);
  const [metadata, setMetadata] = useState<EpubMetadata>({ title: '', creator: '' });
  const [metadataDraft, setMetadataDraft] = useState<EpubMetadata>({ title: '', creator: '' });
  const [metadataLeaveTarget, setMetadataLeaveTarget] = useState<WorkflowStep | null>(null);
  const [originalMetadata, setOriginalMetadata] = useState<EpubMetadata>({
    title: '',
    creator: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [accessibilityModified, setAccessibilityModified] = useState(false);
  const [cssPreview, setCssPreview] = useState<CssCleanupPreview | null>(null);
  const [cssPreviewError, setCssPreviewError] = useState('');
  const [cleanedCssFiles, setCleanedCssFiles] = useState<string[]>([]);
  const [codeFixes, setCodeFixes] = useState<CodeIssueDetail[]>([]);
  const [fixingCodeKey, setFixingCodeKey] = useState<string | null>(null);
  const [tocFixes, setTocFixes] = useState<TocContentFix[]>([]);
  const [tocDraftEdits, setTocDraftEdits] = useState<{ issueId: string; tocText: string; contentText: string }[]>([]);
  const [tocDraftChanged, setTocDraftChanged] = useState(false);
  const [tocExcludedTitles, setTocExcludedTitles] = useState<string[]>(['작가 소개', '판권지', '글의 순서']);
  const [fixingTocId, setFixingTocId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('metadata');
  const [metadataTextFixes, setMetadataTextFixes] = useState<MetadataTextFix[]>([]);
  const [accessibilityFixRequested, setAccessibilityFixRequested] = useState(false);
  const [removeAccFixRequested, setRemoveAccFixRequested] = useState(false);
  const [titleXhtmlFixRequested, setTitleXhtmlFixRequested] = useState(false);
  const [languageFixRequested, setLanguageFixRequested] = useState(false);
  const [sectionTypeFixes, setSectionTypeFixes] = useState<SectionTypeFix[]>([]);
  const [loiFigureFixes, setLoiFigureFixes] = useState<LoiFigureFix[]>([]);
  const [deletedImagePaths, setDeletedImagePaths] = useState<string[]>([]);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [showAppliedItems, setShowAppliedItems] = useState(false);

  function notifySaved(message = '저장되었습니다.') { setToast(message); }

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2200); return () => window.clearTimeout(timer); }, [toast]);

  const hasMetadataChanges =
    metadata.title !== originalMetadata.title || metadata.creator !== originalMetadata.creator;
  const hasChanges =
    hasMetadataChanges ||
    accessibilityModified ||
    cleanedCssFiles.length > 0 ||
    codeFixes.length > 0 ||
    tocFixes.length > 0 ||
    metadataTextFixes.length > 0 ||
    accessibilityFixRequested ||
    removeAccFixRequested ||
    titleXhtmlFixRequested ||
    languageFixRequested ||
    sectionTypeFixes.length > 0 ||
    loiFigureFixes.length > 0 || deletedImagePaths.length > 0;

  const currentStepIndex = WORKFLOW_STEPS.findIndex((step) => step.id === currentStep);

  function hasStepError(step: WorkflowStep): boolean {
    if (!analysis) return false;
    const checks = analysis.checks;
    const textCheckFailed = (value: { exists: boolean; details?: { matched: boolean }[] }) => {
      const details = value.details ?? [];
      return details.length > 0 ? details.some((detail) => !detail.matched) : !value.exists;
    };
    switch (step) {
      case 'metadata-check':
        return !checks.conformsTo || !checks.accFix || checks.titleXhtml.unmatched > 0 ||
          textCheckFailed(checks.coverTitle) || textCheckFailed(checks.coverCreator) ||
          textCheckFailed(checks.copyrightTitle) || textCheckFailed(checks.copyrightCreator) ||
          textCheckFailed(checks.introduceCreator);
      case 'structure':
        return checks.language.unmatched > 0 || checks.chapter.unmatched > 0;
      case 'loi':
        return checks.loiImageNumbers.unmatched > 0 || checks.loiFigcapMissing.unmatched > 0 ||
          checks.loiTocMissing.unmatched > 0 || checks.loiImageDuplicates.unmatched > 0;
      case 'toc':
        return Boolean(checks.tocContent.error) || checks.tocContent.unmatched > 0;
      case 'code':
        return checks.code.dialogue.unmatched > 0 || checks.code.asideRole.unmatched > 0 ||
          checks.code.imageRole.unmatched > 0 || checks.code.footnote.unmatched > 0;
      case 'css':
        return Boolean(cssPreviewError);
      default:
        return false;
    }
  }

  const appliedGroups = [
    ...(hasMetadataChanges ? [{ title: '도서 정보', count: 1, description: '제목과 저자 메타데이터를 업데이트했습니다.' }] : []),
    ...(accessibilityModified || accessibilityFixRequested ? [{ title: '접근성', count: 1, description: 'EPUB 접근성 표기를 WCAG 2.2 AA 기준으로 설정했습니다.' }] : []),
    ...(removeAccFixRequested ? [{ title: 'ACC-fix', count: 1, description: '불필요한 ACC-fix 메타데이터를 제거했습니다.' }] : []),
    ...((titleXhtmlFixRequested || languageFixRequested) ? [{ title: '문서 정보', count: Number(titleXhtmlFixRequested) + Number(languageFixRequested), description: '문서 제목과 언어 설정을 수정했습니다.' }] : []),
    ...(sectionTypeFixes.length ? [{ title: '문서 구조', count: sectionTypeFixes.length, description: '문서 구획 유형을 지정했습니다.' }] : []),
    ...(metadataTextFixes.length ? [{ title: '메타데이터 표기', count: metadataTextFixes.length, description: '저작권·소개 페이지의 제목과 저자 표기를 수정했습니다.' }] : []),
    ...(cleanedCssFiles.length ? [{ title: 'CSS', count: cleanedCssFiles.length, description: '선택한 CSS 파일의 불필요한 스타일을 정리했습니다.' }] : []),
    ...(codeFixes.length ? [{ title: '코드', count: codeFixes.length, description: '대화문·글상자·이미지·각주 코드의 의미와 접근성 표기를 수정했습니다.' }] : []),
    ...(tocFixes.length ? [{ title: '목차', count: tocFixes.length, description: 'TOC와 본문 목차 텍스트를 일치시켰습니다.' }] : []),
    ...(loiFigureFixes.length ? [{ title: '이미지 목차', count: loiFigureFixes.length, description: '이미지 목차 설명 또는 이미지를 수정했습니다.' }] : []),
    ...(deletedImagePaths.length ? [{ title: '이미지 삭제', count: deletedImagePaths.length, description: '선택한 이미지 파일을 EPUB에서 삭제했습니다.' }] : []),
  ];
  const appliedTotal = appliedGroups.reduce((sum, group) => sum + group.count, 0);

  async function navigateToStep(step: WorkflowStep, replace = false, bypassMetadataGuard = false) {
    if (!replace && !bypassMetadataGuard && currentStep === 'metadata' && (metadataDraft.title.trim() !== metadata.title || metadataDraft.creator.trim() !== metadata.creator) && step !== 'metadata') {
      setMetadataLeaveTarget(step);
      return;
    }
    if (!replace && currentStep === 'toc' && tocDraftChanged) {
      const saveChanges = window.confirm('목차 수정사항을 저장하시겠습니까?');
      if (saveChanges) {
        const saved = await handleSaveTocEdits(tocDraftEdits);
        if (!saved) return;
      } else {
        const discardChanges = window.confirm('저장하지 않고 수정사항을 취소한 뒤 이동하시겠습니까?');
        if (!discardChanges) return;
        setTocDraftChanged(false);
      }
    }
    const target = WORKFLOW_STEPS.find((item) => item.id === step);
    if (!target) return;
    setCurrentStep(step);
    if (typeof window !== 'undefined' && window.location.pathname !== target.path) {
      if (replace) window.history.replaceState({ epubChecker: true }, '', target.path);
      else window.history.pushState({ epubChecker: true }, '', target.path);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goPrevious() {
    if (currentStepIndex > 0) {
      navigateToStep(WORKFLOW_STEPS[currentStepIndex - 1].id);
    }
  }

  function goNext() {
    if (currentStepIndex >= 0 && currentStepIndex < WORKFLOW_STEPS.length - 1) {
      navigateToStep(WORKFLOW_STEPS[currentStepIndex + 1].id);
    }
  }

  async function saveMetadataAndContinue() {
    if (!metadataLeaveTarget) return;
    const target = metadataLeaveTarget;
    try {
      await updateMetadata({ title: metadataDraft.title.trim(), creator: metadataDraft.creator.trim() });
      setMetadataLeaveTarget(null);
      await navigateToStep(target, false, true);
    } catch {
      // updateMetadata가 오류 메시지를 표시하므로 모달은 유지합니다.
    }
  }

  async function discardMetadataAndContinue() {
    if (!metadataLeaveTarget) return;
    const target = metadataLeaveTarget;
    setMetadataDraft(metadata);
    setMetadataLeaveTarget(null);
    await navigateToStep(target, false, true);
  }

  useEffect(() => {
    function handlePopState() {
      if (originalFile) setCurrentStep(stepFromPath(window.location.pathname));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [originalFile]);

  useEffect(() => {
    if (currentStep !== 'download' || !originalFile) return;
    let active = true;
    createModifiedEpub(originalFile, metadata, cleanedCssFiles, codeFixes, tocFixes, metadataTextFixes, accessibilityFixRequested, removeAccFixRequested, titleXhtmlFixRequested, languageFixRequested, sectionTypeFixes, loiFigureFixes, deletedImagePaths)
      .then((result) => { if (active) setReportFile(new File([result.blob], originalFile.name, { type: 'application/epub+zip' })); })
      .catch((err) => { console.error('완료 통계용 EPUB 생성 실패:', err); if (active) setReportFile(originalFile); });
    return () => { active = false; };
  }, [currentStep, originalFile, metadata, cleanedCssFiles, codeFixes, tocFixes, metadataTextFixes, accessibilityFixRequested, removeAccFixRequested, titleXhtmlFixRequested, languageFixRequested, sectionTypeFixes, loiFigureFixes, deletedImagePaths]);

  function acceptUploadFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    const epub = selected.find((file) => /\\.epub$/i.test(file.name));
    const pdfs = selected.filter((file) => /\\.pdf$/i.test(file.name));
    if (epub) setUploadEpub(epub);
    if (pdfs.length) {
      const cover = pdfs.find((file) => /cover|표지|커버/i.test(file.name));
      const body = pdfs.find((file) => file !== cover && /body|본문|내지|content/i.test(file.name));
      if (cover && body) { setUploadCoverPdf(cover); setUploadBodyPdf(body); }
      else if (cover) { setUploadCoverPdf(cover); if (pdfs.length > 1) setUploadBodyPdf(pdfs.find((file) => file !== cover) ?? null); }
      else if (body) { setUploadBodyPdf(body); if (pdfs.length > 1) setUploadCoverPdf(pdfs.find((file) => file !== body) ?? null); }
      else { setUploadBodyPdf(pdfs[0]); if (pdfs.length > 1) setUploadCoverPdf(pdfs[1]); }
    }
    setError('');
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      setError('EPUB 파일만 업로드할 수 있습니다.');
      return;
    }

    setLoading(true);
    setError('');
    setCssPreviewError('');
    setCleanedCssFiles([]);
    setCodeFixes([]);
    setSectionTypeFixes([]);
    setLoiFigureFixes([]);
    setDeletedImagePaths([]);
    setTocFixes([]);
    setTocDraftEdits([]);
    setTocDraftChanged(false);
    setFixingTocId(null);

    try {
      const originalAnalysis = await analyzeEpub(file);
      const modifiedResult = await createModifiedEpub(file, originalAnalysis.metadata, []);
      const fileToAnalyze = new File([modifiedResult.blob], file.name, {
        type: 'application/epub+zip',
        lastModified: Date.now(),
      });
      const finalAnalysis = modifiedResult.accessibilityModified
        ? await analyzeEpub(fileToAnalyze)
        : originalAnalysis;

      setOriginalFile(file);
      setCurrentStep('metadata');
      window.history.pushState({ epubChecker: true }, '', '/metadata');
      setAnalysis(finalAnalysis);
      setMetadata({ ...originalAnalysis.metadata });
      setMetadataDraft({ ...originalAnalysis.metadata });
      setMetadataLeaveTarget(null);
      setOriginalMetadata({ ...originalAnalysis.metadata });
      setAccessibilityModified(modifiedResult.accessibilityModified);

      try {
        const zip = await JSZip.loadAsync(file);
        setCssPreview(await previewEpubCss(zip));
      } catch (previewError) {
        setCssPreview(null);
        setCssPreviewError(
          previewError instanceof Error
            ? previewError.message
            : 'CSS 정리 미리보기를 생성하지 못했습니다.',
        );
      }
    } catch (err) {
      console.error('EPUB 분석 실패:', err);
      setError('EPUB 파일을 분석하거나 수정하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function updateMetadata(updatedMetadata: EpubMetadata) {
    if (!originalFile) return;

    setLoading(true);
    setError('');

    try {
      const modifiedResult = await createModifiedEpub(
        originalFile,
        updatedMetadata,
        cleanedCssFiles,
        codeFixes,
        tocFixes,
        metadataTextFixes,
        accessibilityFixRequested,
        removeAccFixRequested,
        titleXhtmlFixRequested,
        languageFixRequested,
        sectionTypeFixes,
        loiFigureFixes,
        deletedImagePaths,
      );
      const modifiedFile = new File([modifiedResult.blob], originalFile.name, {
        type: 'application/epub+zip',
        lastModified: Date.now(),
      });
      const updatedAnalysis = await analyzeEpub(modifiedFile);

      setMetadata(updatedMetadata);
      setMetadataDraft(updatedMetadata);
      setAnalysis(updatedAnalysis);
      setAccessibilityModified(modifiedResult.accessibilityModified);
      notifySaved();
    } catch (err) {
      console.error('메타데이터 수정 실패:', err);
      setError('메타데이터 수정에 실패했습니다.');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function applyMetadataTextFix(detail: MetadataTextDetail, replacementText: string) {
    if (!originalFile || loading || !replacementText.trim()) return;
    const nextFixes = [
      ...metadataTextFixes.filter((item) => !(item.file === detail.file && item.targetType === detail.targetType && item.targetIndex === detail.targetIndex && item.partIndex === detail.partIndex)),
      { ...detail, replacementText },
    ];
    await rebuildWithMetadataFixes({ metadataTextFixes: nextFixes });
  }

  async function applyAllMetadataTextFixes(details: MetadataTextDetail[], replacementText: string) {
    if (!originalFile || loading || !replacementText.trim() || details.length === 0) return;
    const nextFixes = [...metadataTextFixes];
    for (const detail of details) {
      const key = (item: MetadataTextFix) => item.file === detail.file && item.targetType === detail.targetType && item.targetIndex === detail.targetIndex && item.partIndex === detail.partIndex;
      const index = nextFixes.findIndex(key);
      const authorNames = replacementText.split(/[·•ㆍ,，、]/u).map((name) => name.trim()).filter(Boolean);
      const authorDetails = details.filter((item) => item.targetType === 'author-name');
      const authorDetailIndex = authorDetails.indexOf(detail);
      const symbolPrefix = detail.targetType === 'copyright-symbol-text' ? detail.currentText.match(/^(\s*[©Ⓒⓒ]\s*)/u)?.[1] : undefined;
      const bulkReplacement = detail.targetType === 'copyright-symbol-text'
        ? `${symbolPrefix ?? ''}${replacementText}`
        : detail.targetType === 'author-name' && authorNames.length > 1
          ? authorNames[authorDetailIndex] ?? replacementText
          : replacementText;
      const fix = { ...detail, replacementText: bulkReplacement };
      if (index >= 0) nextFixes[index] = fix;
      else nextFixes.push(fix);
    }
    await rebuildWithMetadataFixes({ metadataTextFixes: nextFixes });
  }

  async function fixAccessibilityLevel() {
    await rebuildWithMetadataFixes({ accessibilityFixRequested: true });
  }

  async function removeAccFixTags() {
    await rebuildWithMetadataFixes({ removeAccFixRequested: true });
  }

  async function fixAllXhtmlTitles() {
    await rebuildWithMetadataFixes({ titleXhtmlFixRequested: true });
  }

  async function rebuildWithMetadataFixes(
    updates: Partial<{
      metadataTextFixes: MetadataTextFix[];
      accessibilityFixRequested: boolean;
      removeAccFixRequested: boolean;
      titleXhtmlFixRequested: boolean;
      languageFixRequested: boolean;
      sectionTypeFixes: SectionTypeFix[];
    }>,
  ) {
    if (!originalFile || loading) return;
    const nextTextFixes = updates.metadataTextFixes ?? metadataTextFixes;
    const nextAccessibilityFix = updates.accessibilityFixRequested ?? accessibilityFixRequested;
    const nextRemoveAccFix = updates.removeAccFixRequested ?? removeAccFixRequested;
    const nextTitleFix = updates.titleXhtmlFixRequested ?? titleXhtmlFixRequested;
    const nextLanguageFix = updates.languageFixRequested ?? languageFixRequested;
    const nextSectionTypeFixes = updates.sectionTypeFixes ?? sectionTypeFixes;
    setLoading(true);
    setError('');
    try {
      const result = await createModifiedEpub(
        originalFile, metadata, cleanedCssFiles, codeFixes, tocFixes,
        nextTextFixes, nextAccessibilityFix, nextRemoveAccFix, nextTitleFix, nextLanguageFix, nextSectionTypeFixes, loiFigureFixes,
        deletedImagePaths,
      );
      const modifiedFile = new File([result.blob], originalFile.name, { type: 'application/epub+zip' });
      const updatedAnalysis = await analyzeEpub(modifiedFile);
      setMetadataTextFixes(nextTextFixes);
      setAccessibilityFixRequested(nextAccessibilityFix);
      setRemoveAccFixRequested(nextRemoveAccFix);
      setTitleXhtmlFixRequested(nextTitleFix);
      setLanguageFixRequested(nextLanguageFix);
      setSectionTypeFixes(nextSectionTypeFixes);
      setAnalysis(updatedAnalysis);
      setAccessibilityModified(result.accessibilityModified);
      notifySaved();
    } catch (err) {
      console.error('메타데이터 검사 항목 수정 실패:', err);
      setError('수정 사항을 EPUB에 반영하지 못했습니다.');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function fixLanguage() {
    if (!originalFile || loading) return;
    await rebuildWithMetadataFixes({ languageFixRequested: true });
  }

  async function fixSectionType(file: string, sectionIndex: number, sectionType: 'preface' | 'chapter', newFileName?: string) {
    if (!originalFile || loading) return;
    const next = [...sectionTypeFixes.filter((item) => !(item.file === file && item.sectionIndex === sectionIndex)), { file, sectionIndex, sectionType, ...(newFileName ? { newFileName } : {}) }];
    await rebuildWithMetadataFixes({ sectionTypeFixes: next });
  }

  async function saveLoiCaption(item: { xhtmlFile: string; id: string; caption: string; file: string }, caption: string): Promise<boolean> {
    if (!originalFile || loading) return false;
    const next = mergeLoiFigureFix(loiFigureFixes, { xhtmlFile: item.xhtmlFile, id: item.id, originalCaption: item.caption, imagePath: item.file, caption });
    return applyLoiFigureUpdates(next);
  }

  async function replaceLoiImage(item: { xhtmlFile: string; id: string; caption: string; file: string }, imageFile: File): Promise<boolean> {
    if (!originalFile || loading) return false;
    const next = mergeLoiFigureFix(loiFigureFixes, { xhtmlFile: item.xhtmlFile, id: item.id, originalCaption: item.caption, imagePath: item.file, imageFile });
    return applyLoiFigureUpdates(next);
  }

  async function applyLoiFigureUpdates(nextFixes: LoiFigureFix[]): Promise<boolean> {
    if (!originalFile || loading) return false;
    setLoading(true);
    setError('');
    try {
      const result = await createModifiedEpub(originalFile, metadata, cleanedCssFiles, codeFixes, tocFixes, metadataTextFixes, accessibilityFixRequested, removeAccFixRequested, titleXhtmlFixRequested, languageFixRequested, sectionTypeFixes, nextFixes, deletedImagePaths);
      const modifiedFile = new File([result.blob], originalFile.name, { type: 'application/epub+zip', lastModified: Date.now() });
      const updated = await analyzeEpub(modifiedFile);
      setLoiFigureFixes(nextFixes);
      setAnalysis(updated);
      setAccessibilityModified(result.accessibilityModified);
      notifySaved();
      return true;
    } catch (err) {
      console.error('이미지 목차 수정 실패:', err);
      setError('이미지 목차 수정 사항을 EPUB에 반영하지 못했습니다.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveTocEdits(edits: { issueId: string; tocText: string; contentText: string }[]): Promise<boolean> {
    if (!originalFile || loading || !analysis) return false;
    const nextFixes = [...tocFixes];
    for (const edit of edits) {
      let issue = analysis.checks.tocContent.issues.find((item) => item.id === edit.issueId);
      if (!issue && edit.issueId.startsWith('full-')) {
        const match = edit.issueId.match(/^full-(\d+|x)-(\d+|x)$/);
        if (match) {
          const toc = match[1] === 'x' ? null : analysis.checks.tocContent.tocEntries.find((entry) => entry.index === Number(match[1])) ?? null;
          const content = match[2] === 'x' ? null : analysis.checks.tocContent.contentEntries.find((entry) => entry.index === Number(match[2])) ?? null;
          if (toc || content) issue = { id: edit.issueId, kind: toc && content ? 'text' : toc ? 'missing-in-content' : 'missing-in-toc', toc, content, canAddToToc: Boolean(content?.targetHref), canAddToContent: Boolean(toc?.href) };
        }
      }
      if (!issue) continue;
      if (issue.toc && issue.content) {
        if (edit.tocText !== issue.toc.text) nextFixes.push({ targetSide: 'toc', action: 'update', tocHref: issue.toc.href, tocOriginalText: issue.toc.text, replacementText: edit.tocText });
        if (edit.contentText !== issue.content.text) nextFixes.push({ targetSide: 'content', action: 'update', tocHref: issue.toc.href, tocOriginalText: issue.toc.text, contentOriginalText: issue.content.text, contentClassName: issue.content.className, contentTagName: issue.content.tagName, contentIndex: issue.content.index, replacementText: edit.contentText });
      } else if (!issue.toc && issue.content) {
        if (edit.contentText !== issue.content.text) nextFixes.push({ targetSide: 'content', action: 'update', contentOriginalText: issue.content.text, contentClassName: issue.content.className, contentTagName: issue.content.tagName, contentIndex: issue.content.index, replacementText: edit.contentText });
        if (edit.tocText.trim()) nextFixes.push({ targetSide: 'toc', action: 'add', replacementText: edit.tocText, targetHref: issue.content.targetHref, parentPartText: issue.content.parentPartText, previousText: issue.content.previousText, nextText: issue.content.nextText });
      } else if (!issue.content && issue.toc) {
        if (edit.tocText !== issue.toc.text) nextFixes.push({ targetSide: 'toc', action: 'update', tocHref: issue.toc.href, tocOriginalText: issue.toc.text, replacementText: edit.tocText });
        if (edit.contentText.trim()) nextFixes.push({ targetSide: 'content', action: 'add', replacementText: edit.contentText, targetHref: issue.toc.href, parentPartText: issue.toc.parentPartText, previousText: issue.toc.previousText, nextText: issue.toc.nextText });
      }
    }
    if (nextFixes.length === tocFixes.length) { setTocDraftChanged(false); return true; }
    setLoading(true); setError('');
    try {
      const result = await createModifiedEpub(originalFile, metadata, cleanedCssFiles, codeFixes, nextFixes, metadataTextFixes, accessibilityFixRequested, removeAccFixRequested, titleXhtmlFixRequested, languageFixRequested, sectionTypeFixes, loiFigureFixes, deletedImagePaths);
      const updated = await analyzeEpub(new File([result.blob], originalFile.name, { type: 'application/epub+zip' }));
      setTocFixes(nextFixes); setAnalysis(updated); setAccessibilityModified(result.accessibilityModified); setTocDraftChanged(false);
      notifySaved();
      return true;
    } catch (err) { console.error(err); setError('목차 수정 사항을 저장하지 못했습니다.'); return false; }
    finally { setLoading(false); }
  }

  function handleCleanCss(files: string[]) {
    setCleanedCssFiles((current) => [...new Set([...current, ...files])]);
  }

  async function handleFixCodeIssue(detail: CodeIssueDetail) {
    if (!originalFile || loading || codeFixLockRef.current) return;

    const key = `${detail.file}:${detail.fixType}:${detail.targetIndex}`;
    if (codeFixes.some((item) => `${item.file}:${item.fixType}:${item.targetIndex}` === key))
      return;

    codeFixLockRef.current = true;
    setLoading(true);
    setFixingCodeKey(key);
    setError('');

    try {
      // 한 번의 클릭에서는 선택한 항목 하나만 새 수정으로 추가합니다.
      const nextFixes = [...codeFixes, detail];
      const modifiedResult = await createModifiedEpub(
        originalFile,
        metadata,
        cleanedCssFiles,
        nextFixes,
        tocFixes,
        metadataTextFixes,
        accessibilityFixRequested,
        removeAccFixRequested,
        titleXhtmlFixRequested,
        languageFixRequested,
        sectionTypeFixes,
        loiFigureFixes,
        deletedImagePaths,
      );
      const modifiedFile = new File([modifiedResult.blob], originalFile.name, {
        type: 'application/epub+zip',
        lastModified: Date.now(),
      });
      const updatedAnalysis = await analyzeEpub(modifiedFile);

      setCodeFixes(nextFixes);
      setAnalysis(updatedAnalysis);
      setAccessibilityModified(modifiedResult.accessibilityModified);
      notifySaved();
    } catch (err) {
      console.error('코드 수정 실패:', err);
      setError('코드 구조를 수정하지 못했습니다. 해당 XHTML 구조를 확인해 주세요.');
    } finally {
      setLoading(false);
      setFixingCodeKey(null);
      codeFixLockRef.current = false;
    }
  }

  async function handleDeleteTocIssue(issue: TocContentIssue): Promise<boolean> {
    if (!originalFile || loading) return false;
    const nextFixes = [...tocFixes];
    if (issue.toc) nextFixes.push({ targetSide: 'toc', action: 'delete', tocHref: issue.toc.href, tocOriginalText: issue.toc.text, replacementText: '' });
    if (issue.content) nextFixes.push({ targetSide: 'content', action: 'delete', contentOriginalText: issue.content.text, contentClassName: issue.content.className, contentTagName: issue.content.tagName, contentIndex: issue.content.index, replacementText: '' });
    if (nextFixes.length === tocFixes.length) return false;
    setLoading(true); setError('');
    try {
      const result = await createModifiedEpub(originalFile, metadata, cleanedCssFiles, codeFixes, nextFixes, metadataTextFixes, accessibilityFixRequested, removeAccFixRequested, titleXhtmlFixRequested, languageFixRequested, sectionTypeFixes, loiFigureFixes, deletedImagePaths);
      const updated = await analyzeEpub(new File([result.blob], originalFile.name, { type: 'application/epub+zip' }));
      setTocFixes(nextFixes); setAnalysis(updated); setAccessibilityModified(result.accessibilityModified); setTocDraftChanged(false);
      notifySaved('삭제되었습니다.');
      return true;
    } catch (err) { console.error(err); setError('목차 항목을 삭제하지 못했습니다.'); return false; }
    finally { setLoading(false); }
  }

  async function handleFixTocIssue(issue: TocContentIssue, targetSide: 'toc' | 'content') {
    if (!originalFile || loading || fixingTocId || codeFixLockRef.current || tocFixLockRef.current)
      return;
    const fixingId = `${issue.id}:${targetSide}`;
    let fix: TocContentFix;

    if (targetSide === 'toc') {
      if (issue.toc && issue.content) {
        fix = {
          targetSide,
          action: 'update',
          tocHref: issue.toc.href,
          tocOriginalText: issue.toc.text,
          replacementText: issue.content.text,
        };
      } else if (issue.content?.targetHref) {
        fix = {
          targetSide,
          action: 'add',
          replacementText: issue.content.text,
          targetHref: issue.content.targetHref,
          parentPartText: issue.content.parentPartText,
          previousText: issue.content.previousText,
          nextText: issue.content.nextText,
        };
      } else {
        setError('연결할 문서의 제목과 ID를 찾지 못해 TOC에 자동 추가할 수 없습니다.');
        return;
      }
    } else if (issue.toc && issue.content) {
      fix = {
        targetSide,
        action: 'update',
        tocHref: issue.toc.href,
        tocOriginalText: issue.toc.text,
        contentOriginalText: issue.content.text,
        contentClassName: issue.content.className,
        contentTagName: issue.content.tagName,
        contentIndex: issue.content.index,
        replacementText: issue.toc.text,
      };
    } else if (issue.toc?.href) {
      fix = {
        targetSide,
        action: 'add',
        replacementText: issue.toc.text,
        targetHref: issue.toc.href,
        parentPartText: issue.toc.parentPartText,
        previousText: issue.toc.previousText,
        nextText: issue.toc.nextText,
      };
    } else {
      setError('TOC 항목의 연결 정보가 없어 CONTENT에 자동 추가할 수 없습니다.');
      return;
    }

    const nextFixes = [...tocFixes, fix];
    tocFixLockRef.current = true;
    setLoading(true);
    setFixingTocId(fixingId);
    setError('');
    try {
      const modifiedResult = await createModifiedEpub(
        originalFile,
        metadata,
        cleanedCssFiles,
        codeFixes,
        nextFixes,
        metadataTextFixes,
        accessibilityFixRequested,
        removeAccFixRequested,
        titleXhtmlFixRequested,
        languageFixRequested,
        sectionTypeFixes,
        loiFigureFixes,
        deletedImagePaths,
      );
      const modifiedFile = new File([modifiedResult.blob], originalFile.name, {
        type: 'application/epub+zip',
        lastModified: Date.now(),
      });
      const updatedAnalysis = await analyzeEpub(modifiedFile);
      setTocFixes(nextFixes);
      setAnalysis(updatedAnalysis);
      setAccessibilityModified(modifiedResult.accessibilityModified);
      notifySaved();
    } catch (err) {
      console.error('TOC/CONTENT 수정 실패:', err);
      setError('선택한 항목을 수정하지 못했습니다. EPUB의 목차 구조와 연결 대상을 확인해 주세요.');
    } finally {
      setLoading(false);
      setFixingTocId(null);
      tocFixLockRef.current = false;
    }
  }

  async function deleteImageAsset(path: string): Promise<boolean> {
    if (loading || deletedImagePaths.includes(path)) return false;
    setDeletedImagePaths((current) => [...current, path]);
    notifySaved('삭제되었습니다.');
    return true;
  }

  async function downloadModifiedEpub() {
    if (!originalFile || loading) return;

    setLoading(true);
    setError('');

    try {
      const modifiedResult = await createModifiedEpub(
        originalFile,
        metadata,
        cleanedCssFiles,
        codeFixes,
        tocFixes,
        metadataTextFixes,
        accessibilityFixRequested,
        removeAccFixRequested,
        titleXhtmlFixRequested,
        languageFixRequested,
        sectionTypeFixes,
        loiFigureFixes,
        deletedImagePaths,
      );
      const downloadName = originalFile.name;
      const url = URL.createObjectURL(modifiedResult.blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      notifySaved('다운로드가 시작되었습니다.');
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('EPUB 다운로드 실패:', err);
      setError('수정된 EPUB 파일을 생성하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setOriginalFile(null);
    setUploadEpub(null);
    setUploadBodyPdf(null);
    setUploadCoverPdf(null);
    setCurrentStep('metadata');
    window.history.pushState({ epubChecker: true }, '', '/');
    setAnalysis(null);
    setMetadata({ title: '', creator: '' });
    setMetadataDraft({ title: '', creator: '' });
    setMetadataLeaveTarget(null);
    setOriginalMetadata({ title: '', creator: '' });
    setAccessibilityModified(false);
    setCssPreview(null);
    setCssPreviewError('');
    setCleanedCssFiles([]);
    setCodeFixes([]);
    setSectionTypeFixes([]);
    setLoiFigureFixes([]);
    setDeletedImagePaths([]);
    setTocFixes([]);
    setTocDraftEdits([]);
    setTocDraftChanged(false);
    setTocExcludedTitles(['작가 소개', '판권지', '글의 순서']);
    setMetadataTextFixes([]);
    setAccessibilityFixRequested(false);
    setRemoveAccFixRequested(false);
    setTitleXhtmlFixRequested(false);
    setLanguageFixRequested(false);
    setReportFile(null);
    setShowAppliedItems(false);
    setFixingCodeKey(null);
    setFixingTocId(null);
    codeFixLockRef.current = false;
    tocFixLockRef.current = false;
    setError('');
  }

  return (
    <main className={`app-shell ${originalFile ? 'has-workflow' : ''}`}>
      {!originalFile ? (
        <>
          <div className="upload-top-space" aria-hidden="true" />

          <section className="initial-upload-panel initial-upload-simple">
            <input ref={multiFileInputRef} type="file" multiple accept=".epub,.pdf,application/pdf,application/epub+zip" className="hidden" style={{ display:'none' }} onChange={(event) => { if (event.target.files) acceptUploadFiles(event.target.files); event.target.value = ''; }} />
            <div className={`upload-dropzone initial-multi-dropzone ${uploadDragging ? 'is-dragging' : ''}`} role="button" tabIndex={0} onClick={() => multiFileInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); multiFileInputRef.current?.click(); } }} onDragOver={(event) => { event.preventDefault(); setUploadDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setUploadDragging(false); }} onDrop={(event) => { event.preventDefault(); setUploadDragging(false); acceptUploadFiles(event.dataTransfer.files); }}>
              <span className="upload-icon" aria-hidden="true">↑</span>
              <p className="upload-title">EPUB와 PDF 파일을 여기에 놓으세요.</p>
              <p className="upload-hint">EPUB 1개 · 본문 PDF 1개 · 표지 PDF 1개</p>
              <span className="initial-upload-open">파일 선택</span>
            </div>
            {(uploadEpub || uploadBodyPdf || uploadCoverPdf) && <div className="initial-upload-selected">
              <div><strong>EPUB</strong><span>{uploadEpub?.name ?? '미등록'}</span></div>
              <div><strong>본문 PDF</strong><span>{uploadBodyPdf?.name ?? '미등록'}</span></div>
              <div><strong>표지 PDF</strong><span>{uploadCoverPdf?.name ?? '미등록'}</span></div>
              {uploadBodyPdf && uploadCoverPdf && <button type="button" className="initial-upload-swap" onClick={() => { setUploadBodyPdf(uploadCoverPdf); setUploadCoverPdf(uploadBodyPdf); }}>본문 / 표지 바꾸기</button>}
            </div>}
            <button type="button" className="btn-primary initial-upload-submit" disabled={!uploadEpub || !uploadBodyPdf || !uploadCoverPdf || loading} onClick={() => { if (uploadEpub && uploadBodyPdf && uploadCoverPdf) void handleFile(uploadEpub); }}>{loading ? '검사 중...' : '검사하기'}</button>
            {error && <p className="status-failure" role="alert">{error}</p>}
          </section>
        </>
      ) : (
        <>
          <header className="workflow-sticky-header">
            <div className="workflow-header-inner">
              <button
                type="button"
                className="workflow-brand"
                onClick={() => navigateToStep('metadata')}
                aria-label="EPUB 첫 단계로 이동"
              >
                EPUB
              </button>
              <nav className="workflow-actions" aria-label="주요 작업">
                <button type="button" onClick={downloadModifiedEpub} disabled={!hasChanges || loading} className="workflow-action">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/></svg>
                  <span>완료</span>
                </button>
                <button type="button" onClick={reset} disabled={loading} className="workflow-action workflow-reset">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 6.4"/><path d="M3 4v7h7"/></svg>
                  <span>초기화</span>
                </button>
              </nav>
            </div>
          </header>

          <section className="workflow-progress" aria-label="검사 진행 상황">
            <div className="workflow-progress-meta">
              <span>STEP {currentStepIndex + 1} / {WORKFLOW_STEPS.length}</span>
              <strong>{WORKFLOW_STEPS[currentStepIndex]?.label}</strong>
            </div>
            <div className="workflow-progress-track">
              <div
                className="workflow-progress-value"
                style={{ width: `${((currentStepIndex + 1) / WORKFLOW_STEPS.length) * 100}%` }}
              />
            </div>
            <div className="workflow-step-links">
              {WORKFLOW_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => navigateToStep(step.id)}
                  className={`workflow-step-link ${index === currentStepIndex ? 'is-current' : ''} ${index < currentStepIndex ? 'is-past' : ''} ${hasStepError(step.id) ? 'has-error' : ''}`}
                  aria-current={index === currentStepIndex ? 'step' : undefined}
                  aria-label={`${step.label}${hasStepError(step.id) ? ', 오류 있음' : ''}`}
                  title={`${step.label}${hasStepError(step.id) ? ' · 오류 있음' : ''}`}
                >
                  <span className="workflow-step-dot">{hasStepError(step.id) ? index + 1 : index < currentStepIndex ? '✓' : index + 1}</span>
                  <span className="workflow-step-name">{step.label}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {loading && <p className="loading-message">EPUB 파일을 처리하고 있습니다...</p>}
      {error && <p className="error-message">{error}</p>}

      {metadataLeaveTarget && (
        <div className="confirm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMetadataLeaveTarget(null); }}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="metadata-leave-title" aria-describedby="metadata-leave-description">
            <div className="confirm-modal-icon" aria-hidden="true">!</div>
            <h2 id="metadata-leave-title">저장하지 않은 변경사항이 있습니다</h2>
            <p id="metadata-leave-description">메타데이터 입력 내용을 저장하지 않았습니다. 저장한 뒤 다음 단계로 이동하시겠습니까?</p>
            <div className="confirm-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setMetadataLeaveTarget(null)}>계속 수정</button>
              <button type="button" className="btn-secondary confirm-discard-button" onClick={discardMetadataAndContinue}>저장하지 않고 이동</button>
              <button type="button" className="btn-primary" onClick={saveMetadataAndContinue} disabled={loading}>저장 후 이동</button>
            </div>
          </section>
        </div>
      )}

      {analysis && originalFile && (
        <>
          {currentStep === 'metadata' && (
            <EpubMetadataSection
              metadata={metadata}
              draftMetadata={metadataDraft}
              onDraftChange={setMetadataDraft}
              onSave={updateMetadata}
            />
          )}

          {/* PDF upload and classification state stays mounted between the three cover steps. */}
          <div style={{ display: currentStep === 'cover' || currentStep === 'introduce' || currentStep === 'backcover' ? 'block' : 'none' }}>
            <EpubCoverPdfCheck epubFile={originalFile} coverPdf={uploadCoverPdf} section={currentStep === 'introduce' ? 'introduce' : currentStep === 'backcover' ? 'backcover' : 'cover'} />
          </div>

          {currentStep === 'metadata-check' && (
            <EpubMetadataCheck
              checks={analysis.checks}
              accessibilityModified={accessibilityModified}
              disabled={loading}
              metadataTitle={metadata.title}
              metadataCreator={metadata.creator}
              onFixAccessibility={fixAccessibilityLevel}
              onRemoveAccFix={removeAccFixTags}
              onFixText={applyMetadataTextFix}
              onFixAllTitles={fixAllXhtmlTitles}
              onFixAllText={applyAllMetadataTextFixes}
            />
          )}

          {currentStep === 'structure' && (
            <EpubStructureCheck checks={analysis.checks} disabled={loading} onFixLanguage={fixLanguage} onFixSectionType={fixSectionType} />
          )}

          {currentStep === 'loi' && (
            <EpubLoiCheck checks={analysis.checks} disabled={loading} onSaveCaption={saveLoiCaption} onReplaceImage={replaceLoiImage} />
          )}

          {currentStep === 'toc' && (
            <EpubTocContentResults
              issues={analysis.checks.tocContent.issues}
              tocEntries={analysis.checks.tocContent.tocEntries}
              contentEntries={analysis.checks.tocContent.contentEntries}
              error={analysis.checks.tocContent.error}
              onSave={handleSaveTocEdits}
              onDelete={handleDeleteTocIssue}
              excludedTitles={tocExcludedTitles}
              onSaveExcludedTitles={(titles) => { setTocExcludedTitles(titles); notifySaved(); }}
              onDraftChange={(edits, changed) => { setTocDraftEdits(edits); setTocDraftChanged(changed); }}
              disabled={loading}
            />
          )}

          {currentStep === 'code' && (
            <>
            <EpubCodeResults
              checks={analysis.checks.code}
              file={originalFile}
              onFixIssue={handleFixCodeIssue}
              fixingKey={fixingCodeKey}
              disabled={loading}
              imageAssets={<EpubImageAssets file={originalFile} deletedPaths={deletedImagePaths} onDelete={deleteImageAsset} disabled={loading} issues={analysis.checks.code.imageRole.details} />}
            />
            </>
          )}

          {currentStep === 'css' && (
            <EpubCssCleaner
              preview={cssPreview}
              selectedFiles={cleanedCssFiles}
              onCleanFiles={handleCleanCss}
              disabled={loading}
              error={cssPreviewError}
            />
          )}

          {currentStep === 'download' && (
            <section className="panel download-step-panel">
              <div className="download-step-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/></svg>
              </div>
              <h2>완료</h2>
              <div className="applied-items-section">
                <button type="button" className="applied-items-toggle" onClick={() => setShowAppliedItems((value) => !value)}>
                  <span>적용 항목</span><strong>{appliedTotal}건</strong>
                  <span>{showAppliedItems ? '접기' : '보기'}</span>
                </button>
                {showAppliedItems && <ul className="applied-items-list">{appliedGroups.map((group) => <li key={group.title}><strong>{group.title} {group.count}건</strong><span>{group.description}</span></li>)}</ul>}
              </div>
              {reportFile ? <EpubFinalReport file={reportFile} /> : <p className="report-loading">최종 EPUB 통계 준비 중...</p>}
              <button type="button" onClick={downloadModifiedEpub} disabled={!hasChanges || loading} className="download-final-button">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/></svg>
                EPUB 다운로드
              </button>
            </section>
          )}

          <div className="workflow-bottom-navigation">
            <button type="button" onClick={goPrevious} disabled={currentStepIndex <= 0 || loading} className="btn-secondary">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              이전
            </button>
            {currentStep !== 'download' ? (
              <button type="button" onClick={goNext} disabled={loading} className="btn-primary">
                {currentStep === 'css' ? '완료' : '다음'}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            ) : null}
          </div>
        </>
      )}
      {toast && <div className="app-toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

async function createModifiedEpub(
  originalFile: File,
  metadata: EpubMetadata,
  cssFilesToClean: string[],
  codeFixes: CodeIssueDetail[] = [],
  tocFixes: TocContentFix[] = [],
  metadataTextFixes: MetadataTextFix[] = [],
  accessibilityFixRequested = false,
  removeAccFixRequested = false,
  titleXhtmlFixRequested = false,
  languageFixRequested = false,
  sectionTypeFixes: SectionTypeFix[] = [],
  loiFigureFixes: LoiFigureFix[] = [],
  deletedImagePaths: string[] = [],
): Promise<ModifiedEpubResult> {
  const zip = await JSZip.loadAsync(originalFile);
  const containerFile = zip.file(CONTAINER_PATH);

  if (!containerFile) {
    throw new Error('META-INF/container.xml 파일을 찾을 수 없습니다.');
  }

  const containerText = await containerFile.async('string');
  const containerDocument = new DOMParser().parseFromString(containerText, 'application/xml');

  if (containerDocument.querySelector('parsererror')) {
    throw new Error('container.xml 파일을 읽을 수 없습니다.');
  }

  const rootfile = containerDocument.getElementsByTagNameNS(
    'urn:oasis:names:tc:opendocument:xmlns:container',
    'rootfile',
  )[0];
  const opfPath = rootfile?.getAttribute('full-path');

  if (!opfPath) throw new Error('OPF 파일 경로를 찾을 수 없습니다.');

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('OPF 파일을 찾을 수 없습니다.');

  const opfText = await opfFile.async('string');
  const opfDocument = new DOMParser().parseFromString(opfText, 'application/xml');

  if (opfDocument.querySelector('parsererror')) {
    throw new Error('OPF XML을 읽을 수 없습니다.');
  }

  const metadataElement = opfDocument.getElementsByTagNameNS(OPF_NS, 'metadata')[0];
  if (!metadataElement) throw new Error('OPF metadata 요소를 찾을 수 없습니다.');

  updateDcElement(metadataElement, 'title', metadata.title);
  updateDcElement(metadataElement, 'creator', metadata.creator);
  const accessibilityModified = accessibilityFixRequested && updateAccessibilityLevel(metadataElement);
  if (removeAccFixRequested) removeAccFixMetadata(metadataElement);

  zip.file(opfPath, new XMLSerializer().serializeToString(opfDocument));

  if (metadataTextFixes.length > 0) await applyMetadataTextFixes(zip, metadataTextFixes);
  await normalizeCopyrightSymbols(zip);
  if (titleXhtmlFixRequested) await applyAllXhtmlTitles(zip, metadata.title);
  if (languageFixRequested) await applyKoreanLanguage(zip);
  if (loiFigureFixes.length > 0) await applyLoiFigureFixes(zip, loiFigureFixes);
  if (deletedImagePaths.length > 0) {
    for (const path of deletedImagePaths) zip.remove(path);
    const manifest = opfDocument.getElementsByTagNameNS(OPF_NS, 'manifest')[0];
    if (manifest) {
      const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      const removed = new Set(deletedImagePaths);
      Array.from(manifest.getElementsByTagNameNS(OPF_NS, 'item')).forEach((item) => {
        const href = item.getAttribute('href') ?? '';
        const parts = `${base}${decodeURIComponent(href)}`.split('/');
        const normalized: string[] = [];
        for (const part of parts) { if (!part || part === '.') continue; if (part === '..') normalized.pop(); else normalized.push(part); }
        const resolved = normalized.join('/');
        if (removed.has(resolved)) item.parentNode?.removeChild(item);
      });
      zip.file(opfPath, new XMLSerializer().serializeToString(opfDocument));
    }
  }
  if (sectionTypeFixes.length > 0) await applySectionTypeFixes(zip, sectionTypeFixes);

  if (cssFilesToClean.length > 0) {
    await cleanEpubCss(zip, cssFilesToClean);
  }

  if (codeFixes.length > 0) {
    await applyCodeFixes(zip, codeFixes);
  }

  if (tocFixes.length > 0) {
    await applyTocContentFixes(zip, tocFixes);
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
  });

  return { blob, accessibilityModified };
}

function mergeLoiFigureFix(current: LoiFigureFix[], update: LoiFigureFix): LoiFigureFix[] {
  const index = current.findIndex((item) => item.xhtmlFile === update.xhtmlFile && item.id === update.id && (item.originalCaption ?? '') === (update.originalCaption ?? '') && (item.imagePath ?? '') === (update.imagePath ?? ''));
  if (index < 0) return [...current, update];
  return current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item);
}

async function applyLoiFigureFixes(zip: JSZip, fixes: LoiFigureFix[]) {
  const parser = new DOMParser();
  for (const fix of fixes) {
    const xhtmlEntry = zip.file(fix.xhtmlFile);
    if (!xhtmlEntry) continue;
    const source = await xhtmlEntry.async('string');
    const document = parser.parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    const matchingCaptions = Array.from(document.querySelectorAll('figure p.figcap, figure p.figacp')).filter((element) =>
      element.getAttribute('id') === fix.id && (fix.originalCaption === undefined || (element.textContent ?? '').trim() === fix.originalCaption.trim()),
    );
    const captionElement = matchingCaptions.length === 1 ? matchingCaptions[0] : matchingCaptions.find((element) => {
      const figureImages = Array.from(element.closest('figure')?.querySelectorAll('img[src]') ?? []);
      return !fix.imagePath || figureImages.some((image) => resolveEpubRelativePath(fix.xhtmlFile, image.getAttribute('src') ?? '') === fix.imagePath);
    });
    const figure = captionElement?.closest('figure') ?? null;
    if (!figure) continue;
    if (captionElement && fix.caption !== undefined) captionElement.textContent = fix.caption;

    if (fix.imageFile) {
      const image = figure.querySelector('img[src]');
      if (image) {
        const currentSrc = image.getAttribute('src') ?? '';
        const currentPath = resolveEpubRelativePath(fix.xhtmlFile, currentSrc);
        const directory = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : (fix.xhtmlFile.includes('/') ? fix.xhtmlFile.slice(0, fix.xhtmlFile.lastIndexOf('/') + 1) : '');
        const originalBase = fix.imageFile.name.replace(/[\\/:*?"<>|]/g, '_');
        const dot = originalBase.lastIndexOf('.');
        const stem = dot > 0 ? originalBase.slice(0, dot) : originalBase;
        const extension = dot > 0 ? originalBase.slice(dot) : '';
        let targetPath = `${directory}${originalBase}`;
        let suffix = 2;
        while (zip.file(targetPath) && targetPath !== currentPath) targetPath = `${directory}${stem}-${suffix++}${extension}`;
        zip.file(targetPath, await fix.imageFile.arrayBuffer());
        await registerLoiImageInManifest(zip, targetPath);
        image.setAttribute('src', relativeEpubPath(fix.xhtmlFile, targetPath).split('/').map((part) => encodeURIComponent(part)).join('/'));
      }
    }
    zip.file(fix.xhtmlFile, new XMLSerializer().serializeToString(document));

    if (fix.caption !== undefined) {
      const loiPath = Object.keys(zip.files).find((path) => !zip.files[path].dir && path.split('/').pop()?.toLowerCase() === 'loi.xhtml');
      if (loiPath) {
        const loiEntry = zip.file(loiPath);
        if (loiEntry) {
          const loiDocument = parser.parseFromString(await loiEntry.async('string'), 'application/xhtml+xml');
          const navs = Array.from(loiDocument.querySelectorAll('nav')).filter((nav) => (nav.getAttribute('epub:type') ?? nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').split(/\s+/).includes('loi'));
          for (const anchor of navs.flatMap((nav) => Array.from(nav.querySelectorAll('a[href]')))) {
            const href = anchor.getAttribute('href') ?? '';
            const [pathPart, fragment = ''] = href.split('#', 2);
            let decodedPath = pathPart;
            try { decodedPath = decodeURIComponent(pathPart); } catch { /* malformed path: compare as-is */ }
            const targetFile = pathPart ? resolveEpubRelativePath(loiPath, decodedPath) : loiPath;
            let decodedFragment = fragment;
            try { decodedFragment = decodeURIComponent(fragment); } catch { /* malformed fragment: compare as-is */ }
            if (targetFile === fix.xhtmlFile && decodedFragment === fix.id) anchor.textContent = fix.caption;
          }
          zip.file(loiPath, new XMLSerializer().serializeToString(loiDocument));
        }
      }
    }
  }
}

async function registerLoiImageInManifest(zip: JSZip, imagePath: string) {
  const container = zip.file(CONTAINER_PATH);
  if (!container) throw new Error('container.xml 파일을 찾을 수 없습니다.');
  const containerDocument = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
  const rootfile = containerDocument.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:container', 'rootfile')[0];
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('OPF 파일 경로를 찾을 수 없습니다.');
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error('OPF 파일을 찾을 수 없습니다.');
  const opfDocument = new DOMParser().parseFromString(await opfEntry.async('string'), 'application/xml');
  const manifest = opfDocument.getElementsByTagNameNS(OPF_NS, 'manifest')[0];
  if (!manifest) throw new Error('OPF manifest 요소를 찾을 수 없습니다.');
  const href = relativeEpubPath(opfPath, imagePath).split('/').map((part) => encodeURIComponent(part)).join('/');
  const existing = Array.from(manifest.getElementsByTagNameNS(OPF_NS, 'item')).some((item) => {
    const itemHref = item.getAttribute('href') ?? '';
    let decoded = itemHref;
    try { decoded = decodeURIComponent(itemHref); } catch { /* compare as-is */ }
    return resolveEpubRelativePath(opfPath, decoded) === imagePath;
  });
  if (existing) return;
  const extension = imagePath.split('.').pop()?.toLowerCase() ?? '';
  const mediaType = extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : extension === 'svg' ? 'image/svg+xml' : extension === 'avif' ? 'image/avif' : extension === 'bmp' ? 'image/bmp' : 'image/jpeg';
  let index = 1;
  let id = `loi-replaced-image-${index}`;
  while (opfDocument.getElementById(id) || opfDocument.querySelector(`[id="${id}"]`)) id = `loi-replaced-image-${++index}`;
  const item = opfDocument.createElementNS(OPF_NS, 'item');
  item.setAttribute('id', id);
  item.setAttribute('href', href);
  item.setAttribute('media-type', mediaType);
  manifest.appendChild(item);
  zip.file(opfPath, new XMLSerializer().serializeToString(opfDocument));
}

function resolveEpubRelativePath(fromFile: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0];
  const base = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const joined = cleanHref.startsWith('/') ? cleanHref.slice(1) : `${base ? `${base}/` : ''}${cleanHref}`;
  const parts: string[] = [];
  for (const part of joined.split('/')) { if (!part || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
  return parts.join('/');
}

function relativeEpubPath(fromFile: string, toFile: string): string {
  const fromParts = fromFile.split('/').slice(0, -1);
  const toParts = toFile.split('/');
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) { fromParts.shift(); toParts.shift(); }
  return [...fromParts.map(() => '..'), ...toParts].join('/') || (toFile.split('/').pop() ?? toFile);
}

async function applySectionTypeFixes(zip: JSZip, fixes: SectionTypeFix[]) {
  const renamed = new Map<string, string>();
  for (const fix of fixes) {
    if (!fix.newFileName) continue;
    const oldPath = fix.file;
    const directory = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/') + 1) : '';
    const cleanName = fix.newFileName.split('/').pop() || fix.newFileName;
    if (!/^preface[^/]*\.xhtml$/i.test(cleanName)) continue;
    const newPath = `${directory}${cleanName}`;
    if (oldPath !== newPath) renamed.set(oldPath, newPath);
  }
  for (const [oldPath, newPath] of renamed) {
    const entry = zip.file(oldPath);
    if (!entry || zip.file(newPath)) continue;
    const data = await entry.async('uint8array');
    zip.file(newPath, data);
    zip.remove(oldPath);
    const oldName = oldPath.split('/').pop() || oldPath;
    const newName = newPath.split('/').pop() || newPath;
    const textPaths = Object.keys(zip.files).filter((path) => /\.(xhtml|html|opf|ncx|xml)$/i.test(path) && !zip.files[path].dir);
    for (const textPath of textPaths) {
      const textEntry = zip.file(textPath);
      if (!textEntry) continue;
      const text = await textEntry.async('string');
      const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const updated = text.replace(new RegExp(escaped, 'g'), newName);
      if (updated !== text) zip.file(textPath, updated);
    }
  }

  const grouped = new Map<string, SectionTypeFix[]>();
  for (const fix of fixes) {
    const path = renamed.get(fix.file) || fix.file;
    grouped.set(path, [...(grouped.get(path) ?? []), fix]);
  }
  for (const [path, fileFixes] of grouped) {
    const entry = zip.file(path);
    if (!entry) continue;
    const source = await entry.async('string');
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    const body = document.body;
    if (!body) continue;
    let sections = Array.from(body.children).filter((element) => element.tagName.toLowerCase() === 'section');
    for (const fix of fileFixes) {
      if (sections.length === 0 && fix.sectionIndex === 1) {
        const wrapper = document.createElementNS(XHTML_NS, 'section');
        while (body.firstChild) wrapper.appendChild(body.firstChild);
        body.appendChild(wrapper);
        sections = [wrapper];
      }
      const section = sections[fix.sectionIndex - 1];
      if (!section) continue;
      const value = fix.sectionType;
      section.removeAttribute('epub:type');
      section.setAttributeNS(EPUB_NS, 'epub:type', value);
      section.setAttribute('role', value === 'preface' ? 'doc-preface' : 'doc-chapter');
    }
    zip.file(path, new XMLSerializer().serializeToString(document));
  }
}

function findZipFileByBaseName(zip: JSZip, name: string): string | undefined {
  return Object.keys(zip.files).find(
    (path) => !zip.files[path].dir && path.split('/').pop()?.toLowerCase() === name.toLowerCase(),
  );
}

function directChildByTag(parent: Element, tagName: string): Element | null {
  return (
    Array.from(parent.children).find(
      (child) => child.tagName.toLowerCase() === tagName.toLowerCase(),
    ) ?? null
  );
}

function normalizeTocText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/\t/g, ' ')
    .trim();
}

function findTocAnchor(nav: Element, href?: string, text?: string): HTMLAnchorElement | null {
  return (
    (Array.from(nav.querySelectorAll('a[href]')) as HTMLAnchorElement[]).find(
      (anchor) =>
        (href === undefined || anchor.getAttribute('href') === href) &&
        (text === undefined || (anchor.textContent ?? '').replace(/\s+/g, ' ').trim() === text),
    ) ?? null
  );
}

function findContentElement(document: Document, fix: TocContentFix): Element | null {
  const tagName = fix.contentTagName?.toLowerCase() ?? 'p';
  const candidates = Array.from(document.querySelectorAll(tagName));
  const classes = (fix.contentClassName ?? '').split(/\s+/).filter(Boolean);
  const match = candidates.find(
    (element) =>
      classes.every((className) => element.classList.contains(className)) &&
      normalizeTocText(element.textContent) === fix.contentOriginalText,
  );
  return match ?? candidates[fix.contentIndex ?? -1] ?? null;
}

function addTocEntry(document: Document, nav: Element, fix: TocContentFix) {
  if (!fix.targetHref) throw new Error('추가할 TOC 항목의 링크 주소가 없습니다.');
  let list: Element | null = null;
  if (fix.parentPartText) {
    const parentAnchor = (
      Array.from(nav.querySelectorAll('li > a[href]')) as HTMLAnchorElement[]
    ).find((anchor) => normalizeTocText(anchor.textContent) === fix.parentPartText);
    const parentLi = parentAnchor?.parentElement;
    list = parentLi ? directChildByTag(parentLi, 'ol') : null;
    if (!list && parentLi) {
      list = document.createElementNS(XHTML_NS, 'ol');
      parentLi.appendChild(list);
    }
  }
  if (!list) list = nav.querySelector('ol');
  if (!list) {
    list = document.createElementNS(XHTML_NS, 'ol');
    nav.appendChild(list);
  }
  const li = document.createElementNS(XHTML_NS, 'li');
  const anchor = document.createElementNS(XHTML_NS, 'a');
  anchor.setAttribute('href', fix.targetHref);
  anchor.textContent = fix.replacementText;
  li.appendChild(anchor);

  const directAnchors = Array.from(
    list.querySelectorAll(':scope > li > a[href]'),
  ) as HTMLAnchorElement[];
  const nextAnchor = directAnchors.find(
    (item) => normalizeTocText(item.textContent) === fix.nextText,
  );
  const previousAnchor = directAnchors.find(
    (item) => normalizeTocText(item.textContent) === fix.previousText,
  );
  if (nextAnchor?.parentElement) {
    list.insertBefore(li, nextAnchor.parentElement);
  } else if (previousAnchor?.parentElement) {
    list.insertBefore(li, previousAnchor.parentElement.nextSibling);
  } else if (fix.targetHref.toLowerCase().includes('preface.xhtml')) {
    list.insertBefore(li, list.firstChild);
  } else {
    list.appendChild(li);
  }
}

function findOrCreatePartList(document: Document, partTitle: string): Element | null {
  const heading = Array.from(document.querySelectorAll('p.toc_title')).find(
    (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() === partTitle,
  );
  if (!heading) return null;
  let sibling = heading.nextElementSibling;
  while (sibling && !sibling.matches('p.toc_title')) {
    if (sibling.matches('section.list')) return sibling;
    sibling = sibling.nextElementSibling;
  }
  const list = document.createElementNS(XHTML_NS, 'section');
  list.setAttribute('class', 'list');
  heading.parentElement?.insertBefore(list, heading.nextElementSibling);
  return list;
}

function addContentEntry(document: Document, fix: TocContentFix) {
  const targetFile = (fix.targetHref ?? '').split('#')[0].split('/').pop()?.toLowerCase() ?? '';
  let tagName = 'p';
  let className = 'toc_list';
  if (targetFile === 'content.xhtml') {
    tagName = 'h1';
    className = 'toc_h1';
  } else if (/^part\d+\.xhtml$/.test(targetFile)) {
    className = 'toc_title';
  }

  const element = document.createElementNS(XHTML_NS, tagName);
  element.setAttribute('class', className);
  element.textContent = fix.replacementText;
  const body = document.body ?? document.documentElement;
  const textOf = (item: Element) => normalizeTocText(item.textContent);

  if (className === 'toc_h1') {
    const contentContainer =
      document.querySelector('p.toc_title, p.toc_list')?.parentElement ?? body;
    contentContainer.insertBefore(element, contentContainer.firstChild);
    return;
  }

  if (className === 'toc_title') {
    const headings = Array.from(document.querySelectorAll('p.toc_title'));
    const next = headings.find((item) => textOf(item) === fix.nextText);
    const previous = headings.find((item) => textOf(item) === fix.previousText);
    if (next?.parentElement) {
      next.parentElement.insertBefore(element, next);
    } else if (previous?.parentElement) {
      const previousList = previous.nextElementSibling?.matches('section.list')
        ? previous.nextElementSibling
        : previous;
      previousList.parentElement?.insertBefore(element, previousList.nextSibling);
    } else {
      (headings[0]?.parentElement ?? body).appendChild(element);
    }
    return;
  }

  if (fix.parentPartText) {
    const list = findOrCreatePartList(document, fix.parentPartText);
    if (list) {
      const entries = Array.from(list.querySelectorAll(':scope > p.toc_list'));
      const next = entries.find((item) => textOf(item) === fix.nextText);
      const previous = entries.find((item) => textOf(item) === fix.previousText);
      if (next) list.insertBefore(element, next);
      else if (previous) list.insertBefore(element, previous.nextSibling);
      else list.appendChild(element);
    } else {
      body.appendChild(element);
    }
    return;
  }

  const firstPart = document.querySelector('p.toc_title');
  if (firstPart?.parentElement) firstPart.parentElement.insertBefore(element, firstPart);
  else body.appendChild(element);
}

async function applyTocContentFixes(zip: JSZip, fixes: TocContentFix[]) {
  const tocPath = findZipFileByBaseName(zip, 'toc.xhtml');
  const contentPath = findZipFileByBaseName(zip, 'content.xhtml');
  if (!tocPath || !contentPath)
    throw new Error('toc.xhtml 또는 content.xhtml 파일을 찾을 수 없습니다.');
  const tocEntry = zip.file(tocPath);
  const contentEntry = zip.file(contentPath);
  if (!tocEntry || !contentEntry) throw new Error('목차 파일을 읽을 수 없습니다.');

  const tocDocument = new DOMParser().parseFromString(
    await tocEntry.async('text'),
    'application/xhtml+xml',
  );
  const contentDocument = new DOMParser().parseFromString(
    await contentEntry.async('text'),
    'application/xhtml+xml',
  );
  if (tocDocument.querySelector('parsererror') || contentDocument.querySelector('parsererror')) {
    throw new Error('TOC 또는 CONTENT XHTML 파싱에 실패했습니다.');
  }
  const tocNav =
    tocDocument.querySelector('nav#toc') ??
    Array.from(tocDocument.getElementsByTagNameNS(EPUB_NS, 'nav')).find(
      (element) => element.getAttributeNS(EPUB_NS, 'type') === 'toc',
    ) ??
    null;
  if (!tocNav) throw new Error('toc.xhtml에서 목차 nav를 찾을 수 없습니다.');

  for (const fix of fixes) {
    if (fix.targetSide === 'toc') {
      if (fix.action === 'update') {
        const anchor = findTocAnchor(tocNav, fix.tocHref, fix.tocOriginalText);
        if (!anchor) throw new Error(`TOC 항목을 찾을 수 없습니다: ${fix.tocOriginalText ?? ''}`);
        anchor.textContent = fix.replacementText;
      } else if (fix.action === 'delete') {
        const anchor = findTocAnchor(tocNav, fix.tocHref, fix.tocOriginalText);
        anchor?.closest('li')?.remove();
      } else {
        addTocEntry(tocDocument, tocNav, fix);
      }
    } else if (fix.action === 'update') {
      const element = findContentElement(contentDocument, fix);
      if (!element)
        throw new Error(`CONTENT 항목을 찾을 수 없습니다: ${fix.contentOriginalText ?? ''}`);
      element.textContent = fix.replacementText;
    } else if (fix.action === 'delete') {
      findContentElement(contentDocument, fix)?.remove();
    } else {
      addContentEntry(contentDocument, fix);
    }
  }

  zip.file(tocPath, new XMLSerializer().serializeToString(tocDocument));
  zip.file(contentPath, new XMLSerializer().serializeToString(contentDocument));
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const EPUB_NS = 'http://www.idpf.org/2007/ops';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

function normalizeDialogueQuotes(value: string): string {
  const normalizePair = (text: string, marks: string, open: string, close: string) => {
    const characters = Array.from(text);
    const positions = characters
      .map((character, index) => marks.includes(character) ? index : -1)
      .filter((index) => index >= 0);
    if (positions.length === 0) return text;

    positions.forEach((position, index) => {
      characters[position] = index % 2 === 0 ? open : close;
    });
    if (positions.length % 2 === 1) {
      if (positions.length === 1 && positions[0] === characters.length - 1) characters.unshift(open);
      else characters.push(close);
    }
    return characters.join('');
  };

  let normalized = normalizePair(value, '\"“”', '“', '”');
  // 작은따옴표는 영문 어포스트로피와 구분하기 위해 2개 이상일 때만 처리한다.
  const singleQuoteCount = (normalized.match(/[‘’']/g) ?? []).length;
  if (singleQuoteCount >= 2) {
    normalized = normalizePair(normalized, "‘’'", '‘', '’');
  }
  return normalized;
}

async function applyCodeFixes(zip: JSZip, fixes: CodeIssueDetail[]) {
  const fixesByFile = new Map<string, CodeIssueDetail[]>();
  for (const fix of fixes) {
    const current = fixesByFile.get(fix.file) ?? [];
    current.push(fix);
    fixesByFile.set(fix.file, current);
  }

  for (const [path, fileFixes] of fixesByFile) {
    const entry = zip.file(path);
    if (!entry) throw new Error(`XHTML 파일을 찾을 수 없습니다: ${path}`);

    const source = await entry.async('text');
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) throw new Error(`XHTML 파싱 실패: ${path}`);

    for (const fix of fileFixes) {
      if (fix.fixType === 'dialogue') {
        const paragraph = document.querySelectorAll('p')[fix.targetIndex];
        if (!paragraph) continue;
        paragraph.classList.add('dialog');

        const existingSpeaker = paragraph.querySelector('.speaker');
        const existingSpeech = paragraph.querySelector('.speech');
        const paragraphText = paragraph.textContent?.trim() ?? '';
        let speakerText = existingSpeaker?.textContent?.trim() ?? '';
        let speechText = existingSpeech?.textContent?.trim() ?? '';

        // 기존 speaker/speech 구조가 있으면 각각의 실제 텍스트를 사용하고,
        // 구조가 없다면 첫 번째 콜론을 기준으로 화자와 대사를 분리한다.
        if (!existingSpeech) {
          const colonIndex = paragraphText.indexOf(':');
          if (colonIndex > 0) {
            speakerText = paragraphText.slice(0, colonIndex).trim();
            speechText = paragraphText.slice(colonIndex + 1).trim();
          } else {
            speechText = paragraphText;
          }
        }

        speechText = normalizeDialogueQuotes(speechText);
        paragraph.replaceChildren();
        if (speakerText && speechText) {
          const speaker = document.createElementNS(XHTML_NS, 'span');
          speaker.setAttribute('class', 'speaker');
          speaker.textContent = speakerText;
          const speech = document.createElementNS(XHTML_NS, 'span');
          speech.setAttribute('class', 'speech');
          speech.textContent = speechText;
          paragraph.append(speaker, document.createTextNode(': '), speech);
        } else {
          paragraph.textContent = normalizeDialogueQuotes(paragraphText);
        }
      } else if (fix.fixType === 'aside') {
        const aside = document.querySelectorAll('aside')[fix.targetIndex];
        if (aside) aside.setAttribute('role', fix.asideRole ?? 'doc-tip');
      } else if (fix.fixType === 'image') {
        const image = document.querySelectorAll('img')[fix.targetIndex];
        if (image) image.setAttribute('role', 'img');
      } else if (fix.fixType === 'footnote') {
        const paragraph = document.querySelectorAll('p')[fix.targetIndex];
        if (!paragraph) continue;
        if (document.documentElement.getAttributeNS(XMLNS_NS, 'epub') !== EPUB_NS) {
          document.documentElement.setAttributeNS(XMLNS_NS, 'xmlns:epub', EPUB_NS);
        }
        paragraph.removeAttribute('epub:type');
        paragraph.setAttributeNS(EPUB_NS, 'epub:type', 'footnote');
        paragraph.setAttribute('role', 'doc-footnote');
      }
    }

    zip.file(path, new XMLSerializer().serializeToString(document));
  }
}

async function normalizeCopyrightSymbols(zip: JSZip) {
  const paths = Object.keys(zip.files).filter((path) => path.toLowerCase().endsWith('copyright.xhtml'));
  for (const path of paths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const source = await entry.async('string');
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    let changed = false;
    for (const paragraph of Array.from(document.querySelectorAll('p'))) {
      const text = paragraph.textContent ?? '';
      if (!/글/.test(text) || !/[Ⓒⓒ]/u.test(text)) continue;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (/[Ⓒⓒ]/u.test(node.textContent ?? '')) {
          node.textContent = (node.textContent ?? '').replace(/[Ⓒⓒ]/gu, '©');
          changed = true;
        }
      }
    }
    if (changed) zip.file(path, new XMLSerializer().serializeToString(document));
  }
}

async function applyMetadataTextFixes(zip: JSZip, fixes: MetadataTextFix[]) {
  const grouped = new Map<string, MetadataTextFix[]>();
  fixes.forEach((fix) => grouped.set(fix.file, [...(grouped.get(fix.file) ?? []), fix]));
  for (const [path, fileFixes] of grouped) {
    const entry = zip.file(path);
    if (!entry) continue;
    const source = await entry.async('string');
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    for (const fix of fileFixes) {
      if (fix.targetType === 'alt') {
        const images = Array.from(document.querySelectorAll('img'));
        const image = images[fix.targetIndex];
        if (image) image.setAttribute('alt', fix.replacementText);
      } else if (fix.targetType === 'author-name') {
        const paragraph = document.querySelectorAll('p.author-name')[fix.targetIndex];
        if (paragraph) {
          const firstSpan = Array.from(paragraph.children).find((child) => child.tagName.toLowerCase() === 'span');
          const textNode = Array.from(paragraph.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim());
          if (textNode) {
            if (typeof fix.partIndex === 'number') {
              const original = textNode.textContent ?? '';
              const pieces = original.split(/([·•ㆍ,，、])/u);
              const authorParts = pieces.filter((piece) => !/^[·•ㆍ,，、]$/u.test(piece) && piece.trim());
              const targetPart = authorParts[fix.partIndex];
              if (targetPart !== undefined) {
                let authorIndex = -1;
                textNode.textContent = pieces.map((piece) => {
                  if (/^[·•ㆍ,，、]$/u.test(piece) || !piece.trim()) return piece;
                  authorIndex += 1;
                  return authorIndex === fix.partIndex ? fix.replacementText : piece;
                }).join('');
              }
            } else textNode.textContent = fix.replacementText;
          } else paragraph.insertBefore(document.createTextNode(fix.replacementText), firstSpan ?? null);
        }
      } else if (fix.targetType === 'copy-title') {
        const element = document.querySelectorAll('.copy_title')[fix.targetIndex];
        if (element) element.textContent = fix.replacementText;
      } else if (fix.targetType === 'copyright-symbol-paragraph') {
        const paragraphs = Array.from(document.querySelectorAll('p')).filter((paragraph) => { const text = paragraph.textContent ?? ''; return /글/.test(text) && /동의|저작권/.test(text); });
        const paragraph = paragraphs[fix.targetIndex];
        if (paragraph) paragraph.textContent = fix.replacementText;
      } else if (fix.targetType === 'copy-author') {
        const values = Array.from(document.querySelectorAll('.copy_b')).filter((label) => (label.textContent ?? '').includes('지은이')).map((label) => label.nextElementSibling).filter((element): element is Element => Boolean(element?.classList.contains('copy_t')));
        const element = values[fix.targetIndex];
        if (element) element.textContent = fix.replacementText;
      } else {
        const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
        let index = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!(node.textContent ?? '').trim()) continue;
          if (index === fix.targetIndex) {
            node.textContent = fix.replacementText;
            break;
          }
          index += 1;
        }
      }
    }
    zip.file(path, new XMLSerializer().serializeToString(document));
  }
}

async function applyKoreanLanguage(zip: JSZip) {
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && path.toLowerCase().endsWith('.xhtml'));
  for (const path of paths) {
    const entry = zip.file(path); if (!entry) continue;
    const document = new DOMParser().parseFromString(await entry.async('text'), 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    document.documentElement.setAttribute('lang', 'ko');
    document.documentElement.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'ko');
    zip.file(path, new XMLSerializer().serializeToString(document));
  }
}

async function applyAllXhtmlTitles(zip: JSZip, title: string) {
  const excluded = new Set(['loi.xhtml', 'toc.xhtml', 'lot.xhtml', 'cover.xhtml']);
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && /\.xhtml?$/i.test(path));
  for (const path of paths) {
    if (excluded.has(path.split('/').pop()?.toLowerCase() ?? '')) continue;
    const entry = zip.file(path);
    if (!entry) continue;
    const source = await entry.async('string');
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    let titleElement = document.querySelector('head title');
    if (!titleElement) {
      const head = document.querySelector('head');
      if (!head) continue;
      titleElement = document.createElementNS('http://www.w3.org/1999/xhtml', 'title');
      head.appendChild(titleElement);
    }
    titleElement.textContent = title;
    zip.file(path, new XMLSerializer().serializeToString(document));
  }
}

function removeAccFixMetadata(metadataElement: Element) {
  Array.from(metadataElement.getElementsByTagName('meta')).forEach((element) => {
    const key = `${element.getAttribute('property') ?? ''} ${element.getAttribute('name') ?? ''}`.toLowerCase();
    if (key.includes('acc-fix')) element.remove();
  });
}

function updateAccessibilityLevel(metadataElement: Element): boolean {
  const conformElements = Array.from(metadataElement.getElementsByTagName('meta')).filter(
    (element) => element.getAttribute('property') === 'dcterms:conformsTo',
  );

  if (conformElements.length === 0) return false;

  let modified = false;
  conformElements.forEach((element) => {
    const value = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (
      value === 'EPUB Accessibility 1.1 - WCAG 2.2 Level A' ||
      value === 'EPUB Accessibility 1.1 - WCAG 2.2 Level AAA'
    ) {
      element.textContent = ACCESSIBILITY_AA;
      modified = true;
    }
  });

  return modified;
}

function updateDcElement(metadataElement: Element, tagName: 'title' | 'creator', value: string) {
  let element = metadataElement.getElementsByTagNameNS(DC_NS, tagName)[0];

  if (!element) {
    element = metadataElement.ownerDocument.createElementNS(DC_NS, `dc:${tagName}`);
    metadataElement.appendChild(element);
  }

  element.textContent = value;
}
