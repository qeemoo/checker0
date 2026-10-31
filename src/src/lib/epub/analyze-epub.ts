import type {
  EpubAnalysisResult,
  EpubMetadata,
  EpubMetadataChecks,
  FileCheckResult,
  TitleCheckResult,
  ChapterFailureDetail,
  CodeCheckItemResult,
  CodeIssueDetail,
  EpubCodeChecks,
  MetadataTextDetail,
} from '../../types/epub';
import { parseEpub } from './parse-epub';
import { getFileName, normalizeText } from './epub-utils';
import { checkLoi } from './check-loi';
import { readEpubMetadata } from './check-metadata';
import { checkTocContent } from './check-toc-content';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const EPUB_NS = 'http://www.idpf.org/2007/ops';
const EXPECTED_CONFORMS_TO = 'EPUB Accessibility 1.1 - WCAG 2.2 Level AA';
const EXCLUDED_TITLE_FILES = ['loi.xhtml', 'toc.xhtml', 'lot.xhtml', 'cover.xhtml'];
const EXCLUDED_CHAPTER_FILES = [
  'cover.xhtml',
  'incover.xhtml',
  'loi.xhtml',
  'copyright.xhtml',
  'incover2.xhtml',
  'toc.xhtml',
  'introduce.xhtml',
  'backcover.xhtml',
  'preface.xhtml',
  'preface1.xhtml',
  'preface2.xhtml',
  'preface3.xhtml',
  'preface4.xhtml',
  'preface5.xhtml',
  'preface6.xhtml',
  'preface7.xhtml',
  'preface8.xhtml',
  'preface9.xhtml',
];

function findFile(files: { path: string; document: Document }[], name: string) {
  return files.find((file) => getFileName(file.path) === name);
}
function bodyText(document: Document): string {
  return normalizeText(document.body?.textContent);
}
function containsMetadataText(document: Document | undefined, value: string): boolean {
  return Boolean(value && document && bodyText(document).includes(value));
}
function imageAltMatches(document: Document | undefined, value: string): number {
  if (!document || !value) return 0;
  return Array.from(document.querySelectorAll('img[alt]')).filter((image) =>
    (image.getAttribute('alt') ?? '').includes(value),
  ).length;
}
function checkTitleXhtml(
  files: { path: string; document: Document }[],
  title: string,
): TitleCheckResult {
  const targets = files.filter((file) => !EXCLUDED_TITLE_FILES.includes(getFileName(file.path)));
  const details = targets.map((file) => {
    const currentTitle = normalizeText(file.document.querySelector('title')?.textContent);
    return { file: file.path, title: currentTitle, matched: currentTitle === normalizeText(title) };
  });
  const unmatchedFiles = details.filter((item) => !item.matched).map((item) => item.file);
  return {
    total: targets.length,
    matched: targets.length - unmatchedFiles.length,
    unmatched: unmatchedFiles.length,
    excluded: [...EXCLUDED_TITLE_FILES],
    unmatchedFiles,
    details,
  };
}

function textNodeDetails(
  file: { path: string; document: Document } | undefined,
  value: string,
): MetadataTextDetail[] {
  if (!file || !value) return [];
  const walker = file.document.createTreeWalker(file.document.body ?? file.document, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').trim()) nodes.push(node as Text);
  }
  const matching = nodes.filter((item) => (item.textContent ?? '').includes(value));
  const candidates = matching.length ? matching : nodes.filter((item) => {
    const parent = item.parentElement;
    return Boolean(parent && /^(P|DIV|SPAN|H[1-6]|LI|FIGCAPTION)$/.test(parent.tagName));
  }).slice(0, 20);
  return candidates.map((item) => {
    const targetIndex = nodes.indexOf(item);
    return {
      file: file.path,
      targetType: 'text' as const,
      targetIndex,
      currentText: item.textContent ?? '',
      preview: item.parentElement?.outerHTML ?? item.textContent ?? '',
      matched: (item.textContent ?? '').includes(value),
    };
  });
}

function coverAltDetails(
  file: { path: string; document: Document } | undefined,
  value: string,
): MetadataTextDetail[] {
  if (!file) return [];
  return Array.from(file.document.querySelectorAll('img[alt]')).map((image, targetIndex) => ({
    file: file.path,
    targetType: 'alt' as const,
    targetIndex,
    currentText: image.getAttribute('alt') ?? '',
    preview: image.outerHTML,
    matched: Boolean(value && (image.getAttribute('alt') ?? '').includes(value)),
  }));
}

function checkLanguage(files: { path: string; document: Document }[]): FileCheckResult {
  const fileValues = files.map(({ path, document }) => ({
    file: path,
    lang: document.documentElement.getAttribute('lang'),
    xmlLang: document.documentElement.getAttributeNS(XML_NS, 'lang'),
  }));
  const unmatchedFiles = fileValues.filter((item) => item.lang !== 'ko' || item.xmlLang !== 'ko').map((item) => item.file);
  return {
    total: files.length,
    matched: files.length - unmatchedFiles.length,
    unmatched: unmatchedFiles.length,
    unmatchedFiles,
    fileValues,
  };
}
function checkChapter(files: { path: string; document: Document }[]): FileCheckResult {
  const contentIndex = files.findIndex((file) => getFileName(file.path) === 'content.xhtml');
  const ordered = contentIndex >= 0 ? files.slice(contentIndex) : files;
  const targets = ordered.filter(
    (file) => !EXCLUDED_CHAPTER_FILES.includes(getFileName(file.path)),
  );
  let total = 0;
  let matched = 0;
  const unmatchedFiles: string[] = [];
  const unmatchedDetails: ChapterFailureDetail[] = [];

  for (const file of targets) {
    const body = file.document.body;
    const sections = body
      ? Array.from(body.children).filter((child) => child.tagName.toLowerCase() === 'section')
      : [];
    if (sections.length === 0) {
      total += 1;
      unmatchedFiles.push(file.path);
      unmatchedDetails.push({
        file: file.path,
        sectionIndex: 0,
        epubType: null,
        role: null,
        reasons: ['body 바로 아래에 section 요소가 없습니다.'],
        html: body?.innerHTML ?? '',
      });
      continue;
    }
    sections.forEach((section, index) => {
      total += 1;
      const epubType = section.getAttributeNS(EPUB_NS, 'type') ?? section.getAttribute('epub:type');
      const role = section.getAttribute('role');
      const reasons: string[] = [];
      if (epubType !== 'chapter') reasons.push('epub:type이 "chapter"가 아닙니다.');
      if (role !== 'doc-chapter') reasons.push('role이 "doc-chapter"가 아닙니다.');
      if (reasons.length === 0) matched += 1;
      else {
        if (!unmatchedFiles.includes(file.path)) unmatchedFiles.push(file.path);
        unmatchedDetails.push({
          file: file.path,
          sectionIndex: index + 1,
          epubType,
          role,
          reasons,
          html: section.outerHTML,
        });
      }
    });
  }
  return { total, matched, unmatched: total - matched, unmatchedFiles, unmatchedDetails };
}

function hasClass(element: Element, className: string): boolean {
  return element.classList.contains(className);
}

function elementHtml(element: Element): string {
  return element.outerHTML;
}

function isDialogueText(text: string): boolean {
  // 예: 인물 이름: "대사" 또는 인물 이름: '대사'
  return /[^:\n]{1,80}:\s*["'“‘”’][\s\S]+["'”’]/.test(normalizeText(text));
}

function makeCodeCheck(total: number, details: CodeIssueDetail[]): CodeCheckItemResult {
  const failed = details.filter((detail) => detail.reasons.length > 0).length;
  return { total, matched: total - failed, unmatched: failed, details };
}

function hasBalancedCurlyQuotes(text: string): boolean {
  for (const [open, close] of [['“', '”'], ['‘', '’']]) {
    let expectingClose = false;
    for (const character of text) {
      if (character === open) { if (expectingClose) return false; expectingClose = true; }
      else if (character === close) { if (!expectingClose) return false; expectingClose = false; }
    }
    if (expectingClose) return false;
  }
  return true;
}

function checkCodeStructure(files: { path: string; document: Document }[]): EpubCodeChecks {
  const dialogueDetails: CodeIssueDetail[] = [];
  const asideDetails: CodeIssueDetail[] = [];
  const imageDetails: CodeIssueDetail[] = [];
  const footnoteDetails: CodeIssueDetail[] = [];
  let dialogueTotal = 0;
  let asideTotal = 0;
  let imageTotal = 0;
  let footnoteTotal = 0;

  for (const file of files) {
    const { document, path } = file;

    Array.from(document.querySelectorAll('p')).forEach((paragraph, targetIndex) => {
      const dialog = hasClass(paragraph, 'dialog');
      const speaker = paragraph.querySelector('.speaker');
      const speech = paragraph.querySelector('.speech');
      const hasDialogueChild = Boolean(speaker || speech);
      const isDialogueCandidate =
        dialog || hasDialogueChild || isDialogueText(paragraph.textContent ?? '');
      if (!isDialogueCandidate) return;

      dialogueTotal += 1;
      const reasons: string[] = [];
      if (!dialog) reasons.push('대화문 p에 class="dialog"가 없습니다.');
      if (!speaker) reasons.push('class="speaker" 요소가 없습니다.');
      if (!speech) reasons.push('class="speech" 요소가 없습니다.');
      if (!hasBalancedCurlyQuotes(paragraph.textContent ?? '')) reasons.push('여닫는 따옴표 쌍이 올바르지 않습니다.');
      if (reasons.length > 0) {
        dialogueDetails.push({
          file: path,
          element: 'p.dialog',
          reasons,
          html: elementHtml(paragraph),
          fixType: 'dialogue',
          targetIndex,
        });
      }
    });

    Array.from(document.querySelectorAll('aside')).forEach((aside, targetIndex) => {
      asideTotal += 1;
      const role = aside.getAttribute('role');
      asideDetails.push({
        file: path,
        element: 'aside',
        reasons: role !== 'none' && role !== 'doc-tip' ? ['role이 "none" 또는 "doc-tip"이 아닙니다.'] : [],
        html: elementHtml(aside),
        fixType: 'aside',
        targetIndex,
        asideRole: role === 'none' ? 'none' : 'doc-tip',
      });
    });

    Array.from(document.querySelectorAll('img')).forEach((image, targetIndex) => {
      imageTotal += 1;
      const role = image.getAttribute('role');
      if (role !== 'doc-cover' && role !== 'img' && role !== 'presentation') {
        imageDetails.push({
          file: path,
          element: 'img',
          reasons: ['role이 "doc-cover", "img", "presentation" 중 하나가 아닙니다.'],
          html: elementHtml(image),
          fixType: 'image',
          targetIndex,
        });
      }
    });

    Array.from(document.querySelectorAll('p')).forEach((paragraph, targetIndex) => {
      const note = paragraph.querySelector('sup.note');
      if (!note) return;
      const text = normalizeText(paragraph.textContent ?? '');
      const marker = normalizeText(note.textContent ?? '');
      const markerIndex = marker ? text.indexOf(marker) : -1;
      const afterMarker =
        markerIndex >= 0 ? text.slice(markerIndex + marker.length).replace(/^\s+/, '') : '';
      const looksLikeParentheticalNote =
        text.startsWith('(') && text.endsWith(')') && afterMarker.startsWith(':');
      if (!looksLikeParentheticalNote) return;

      footnoteTotal += 1;
      const epubType =
        paragraph.getAttributeNS(EPUB_NS, 'type') ?? paragraph.getAttribute('epub:type');
      const role = paragraph.getAttribute('role');
      const reasons: string[] = [];
      if (epubType !== 'footnote') reasons.push('epub:type="footnote"가 없습니다.');
      if (role !== 'doc-footnote') reasons.push('role="doc-footnote"가 없습니다.');
      if (reasons.length > 0) {
        footnoteDetails.push({
          file: path,
          element: 'p (각주)',
          reasons,
          html: elementHtml(paragraph),
          fixType: 'footnote',
          targetIndex,
        });
      }
    });
  }

  return {
    dialogue: makeCodeCheck(dialogueTotal, dialogueDetails),
    asideRole: makeCodeCheck(asideTotal, asideDetails),
    imageRole: makeCodeCheck(imageTotal, imageDetails),
    footnote: makeCodeCheck(footnoteTotal, footnoteDetails),
  };
}

export async function analyzeEpub(file: File): Promise<EpubAnalysisResult> {
  const parsed = await parseEpub(file);
  const files = parsed.xhtmlFiles;
  const metadata: EpubMetadata = readEpubMetadata(parsed.metadataElement);
  const { title, creator } = metadata;

  const cover = findFile(files, 'cover.xhtml');
  const copyright = findFile(files, 'copyright.xhtml');
  const introduce = findFile(files, 'introduce.xhtml');
  const conforms = Array.from(parsed.metadataElement.getElementsByTagName('meta'));
  const conformsToElement = conforms.find((element) => element.getAttribute('property') === 'dcterms:conformsTo');
  const conformsToValue = conformsToElement?.textContent?.trim() ?? null;
  const conformsTo = normalizeText(conformsToValue) === normalizeText(EXPECTED_CONFORMS_TO);
  const accFixTags = conforms
    .filter((element) => `${element.getAttribute('property') ?? ''} ${element.getAttribute('name') ?? ''}`.toLowerCase().includes('acc-fix'))
    .map((element) => element.outerHTML);
  const accFix = accFixTags.length === 0;
  const loi = await checkLoi(parsed.zip, files);

  const checks: EpubMetadataChecks = {
    titleXhtml: checkTitleXhtml(files, title),
    coverTitle: {
      exists: imageAltMatches(cover?.document, title) > 0,
      count: imageAltMatches(cover?.document, title),
      details: coverAltDetails(cover, title),
    },
    copyrightTitle: {
      exists: containsMetadataText(copyright?.document, title),
      count: Number(containsMetadataText(copyright?.document, title)),
      details: textNodeDetails(copyright, title),
    },
    coverCreator: {
      exists: imageAltMatches(cover?.document, creator) > 0,
      count: imageAltMatches(cover?.document, creator),
      details: coverAltDetails(cover, creator),
    },
    introduceCreator: {
      exists: containsMetadataText(introduce?.document, creator),
      count: Number(containsMetadataText(introduce?.document, creator)),
      details: textNodeDetails(introduce, creator),
    },
    copyrightCreator: {
      exists: containsMetadataText(copyright?.document, creator),
      count: Number(containsMetadataText(copyright?.document, creator)),
      details: textNodeDetails(copyright, creator),
    },
    conformsTo,
    conformsToValue,
    accFix,
    accFixTags,
    language: checkLanguage(files),
    chapter: checkChapter(files),
    loiItems: loi.loiItems,
    loiImageDuplicates: loi.loiImageDuplicates,
    loiImageNumbers: loi.loiImageNumbers,
    tocContent: checkTocContent(files),
    code: checkCodeStructure(files),
  };
  return { metadata, checks };
}
