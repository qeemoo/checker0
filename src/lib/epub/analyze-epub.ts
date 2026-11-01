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
function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, '');
}

function textContainsExpected(actual: string, expected: string): { matched: boolean; status: 'match' | 'mismatch' | 'suspect' } {
  if (!expected) return { matched: false, status: 'mismatch' };
  if (normalizeText(actual).includes(normalizeText(expected))) return { matched: true, status: 'match' };
  if (compactText(actual).includes(compactText(expected))) return { matched: false, status: 'suspect' };
  return { matched: false, status: 'mismatch' };
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
  if (!file) return [];
  const walker = file.document.createTreeWalker(file.document.body ?? file.document, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').trim()) nodes.push(node as Text);
  }
  const matching = nodes.filter((item) => textContainsExpected(item.textContent ?? '', value).matched || textContainsExpected(item.textContent ?? '', value).status === 'suspect');
  const candidates = value && matching.length ? matching : nodes.filter((item) => {
    const parent = item.parentElement;
    return Boolean(parent && /^(P|DIV|SPAN|H[1-6]|LI|FIGCAPTION)$/.test(parent.tagName));
  }).slice(0, 20);
  return candidates.map((item) => {
    const targetIndex = nodes.indexOf(item);
    const comparison = textContainsExpected(item.textContent ?? '', value);
    return {
      file: file.path,
      targetType: 'text' as const,
      targetIndex,
      currentText: item.textContent ?? '',
      preview: item.parentElement?.outerHTML ?? item.textContent ?? '',
      matched: comparison.matched,
      status: comparison.status,
    };
  });
}

function allImageAltDetails(
  file: { path: string; document: Document } | undefined,
  value: string,
  isCreator = false,
): MetadataTextDetail[] {
  if (!file) return [];
  return Array.from(file.document.querySelectorAll('img')).map((image, targetIndex) => {
    const currentText = image.getAttribute('alt') ?? '';
    const comparison = textContainsExpected(currentText, value);
    const status = isCreator && /지음/.test(currentText) && comparison.status === 'mismatch' ? 'suspect' : comparison.status;
    return {
      file: file.path,
      targetType: 'alt' as const,
      targetIndex,
      currentText,
      preview: image.outerHTML,
      matched: comparison.matched,
      status,
    };
  });
}

function scopedElementTextDetails(
  file: { path: string; document: Document } | undefined,
  selector: string,
  expected: string,
  targetType: 'copy-title' | 'copy-author' = 'copy-title',
  getText?: (element: Element) => string,
): MetadataTextDetail[] {
  if (!file) return [];
  return Array.from(file.document.querySelectorAll(selector)).map((element, targetIndex) => {
    const currentText = getText ? getText(element) : (element.textContent ?? '').trim();
    const comparison = textContainsExpected(currentText, expected);
    return {
      file: file.path,
      targetType,
      targetIndex,
      currentText,
      preview: element.outerHTML,
      matched: comparison.matched,
      status: comparison.status,
    };
  });
}

function splitAuthorNames(value: string): string[] {
  return value.split(/[·•ㆍ,，、]/u).map((item) => normalizeText(item)).filter(Boolean);
}

function introAuthorDetails(
  file: { path: string; document: Document } | undefined,
  creator: string,
): MetadataTextDetail[] {
  if (!file) return [];
  const expectedAuthors = splitAuthorNames(creator);
  return Array.from(file.document.querySelectorAll('p.author-name')).flatMap((paragraph, targetIndex) => {
    const firstSpan = Array.from(paragraph.children).find((child) => child.tagName.toLowerCase() === 'span');
    const textNode = Array.from(paragraph.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim());
    const currentText = normalizeText(textNode?.textContent ?? (firstSpan ? '' : paragraph.textContent ?? ''));
    const parsedAuthors = splitAuthorNames(currentText);
    const authors = parsedAuthors.length ? parsedAuthors : [''];
    const hasSeparators = /[·•ㆍ,，、]/u.test(currentText);
    const multipleExpected = expectedAuthors.length > 1;
    return authors.map((author, partIndex) => {
      const matched = expectedAuthors.some((expected) => compactText(expected) === compactText(author));
      const uncertainMultiple = !hasSeparators && multipleExpected && !matched;
      return {
        file: file.path,
        targetType: 'author-name' as const,
        targetIndex,
        partIndex: hasSeparators ? partIndex : undefined,
        currentText: author,
        preview: paragraph.outerHTML,
        matched,
        status: matched ? 'match' as const : uncertainMultiple ? 'suspect' as const : 'mismatch' as const,
      };
    });
  });
}

function copyrightTitleDetails(file: { path: string; document: Document } | undefined, title: string): MetadataTextDetail[] {
  return scopedElementTextDetails(file, '.copy_title', title, 'copy-title');
}

function copyrightAuthorDetails(file: { path: string; document: Document } | undefined, creator: string): MetadataTextDetail[] {
  if (!file) return [];
  const details: MetadataTextDetail[] = [];
  const authorValues = Array.from(file.document.querySelectorAll('.copy_b'))
    .filter((element) => normalizeText(element.textContent).includes('지은이'))
    .map((label) => label.nextElementSibling)
    .filter((element): element is Element => Boolean(element?.classList.contains('copy_t')));

  authorValues.forEach((element, targetIndex) => {
    const currentText = (element.textContent ?? '').trim();
    const comparison = textContainsExpected(currentText, creator);
    details.push({ file: file.path, targetType: 'copy-author', targetIndex, currentText, preview: element.parentElement?.outerHTML ?? element.outerHTML, matched: comparison.matched, status: comparison.status === 'mismatch' ? 'suspect' : comparison.status });
  });

  const copyrightParagraphs = Array.from(file.document.querySelectorAll('p')).filter((paragraph) => {
    const text = paragraph.textContent ?? '';
    return /글/.test(text) && (/[©Ⓒⓒ]/u.test(text) || (creator && compactText(text).includes(compactText(creator))));
  });
  copyrightParagraphs.forEach((paragraph, targetIndex) => {
    const walker = file.document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    let symbolNode: Node | null = null;
    let authorNode: Node | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!symbolNode && /[©Ⓒⓒ]/u.test(node.textContent ?? '')) symbolNode = node;
      if (!authorNode && creator && compactText(node.textContent ?? '').includes(compactText(creator))) authorNode = node;
    }
    textNode = authorNode ?? symbolNode;
    const currentText = textNode?.textContent ?? paragraph.textContent ?? '';
    const paragraphText = paragraph.textContent ?? '';
    const authorText = paragraphText.replace(/[©Ⓒⓒ]/gu, '').replace(/[()（）]/gu, '').trim();
    const comparison = textContainsExpected(authorText, creator);
    const correctSymbol = /©/u.test(paragraphText) && !/[Ⓒⓒ]/u.test(paragraphText);
    const matched = comparison.matched && correctSymbol;
    const status = !correctSymbol ? 'mismatch' as const : comparison.status === 'mismatch' ? 'suspect' as const : comparison.status;
    details.push({ file: file.path, targetType: 'copyright-symbol-text', targetIndex: findTextNodeIndex(file.document, textNode), currentText, preview: paragraph.outerHTML, matched, status });
  });
  return details;
}

function findTextNodeIndex(document: Document, target: Node | null): number {
  if (!target) return -1;
  const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
  let index = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node.textContent ?? '').trim()) continue;
    if (node === target) return index;
    index += 1;
  }
  return -1;
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
        sectionIndex: 1,
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
      const isPrefaceFile = /^preface[^/]*\.xhtml$/i.test(getFileName(file.path));
      const expectedType = isPrefaceFile ? 'preface' : 'chapter';
      const expectedRole = isPrefaceFile ? 'doc-preface' : 'doc-chapter';
      const reasons: string[] = [];
      if (epubType !== expectedType) reasons.push(`epub:type이 "${expectedType}"가 아닙니다.`);
      if (role !== expectedRole) reasons.push(`role이 "${expectedRole}"가 아닙니다.`);
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
  // 대화문에는 곡선형 여닫는 따옴표를 사용한다. 직선형 따옴표는
  // 쌍이 맞더라도 수정 대상으로 처리해 자동 수정 단계에서 변환한다.
  if (text.includes('"')) return false;
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
          imageSrc: image.getAttribute('src') ?? '',
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
      exists: allImageAltDetails(cover, title).length > 0 && allImageAltDetails(cover, title).every((detail) => detail.matched),
      count: allImageAltDetails(cover, title).filter((detail) => detail.matched).length,
      details: allImageAltDetails(cover, title),
    },
    copyrightTitle: {
      exists: copyrightTitleDetails(copyright, title).length > 0 && copyrightTitleDetails(copyright, title).every((detail) => detail.matched),
      count: copyrightTitleDetails(copyright, title).filter((detail) => detail.matched).length,
      details: copyrightTitleDetails(copyright, title),
    },
    coverCreator: {
      exists: allImageAltDetails(cover, creator, true).length > 0 && allImageAltDetails(cover, creator, true).every((detail) => detail.matched),
      count: allImageAltDetails(cover, creator, true).filter((detail) => detail.matched).length,
      details: allImageAltDetails(cover, creator, true),
    },
    introduceCreator: {
      exists: introAuthorDetails(introduce, creator).length > 0 && introAuthorDetails(introduce, creator).every((detail) => detail.matched),
      count: introAuthorDetails(introduce, creator).filter((detail) => detail.matched).length,
      details: introAuthorDetails(introduce, creator),
    },
    copyrightCreator: {
      exists: copyrightAuthorDetails(copyright, creator).length > 0 && copyrightAuthorDetails(copyright, creator).every((detail) => detail.matched),
      count: copyrightAuthorDetails(copyright, creator).filter((detail) => detail.matched).length,
      details: copyrightAuthorDetails(copyright, creator),
    },
    copyrightSymbol: { exists: true, count: 0, details: [] },
    conformsTo,
    conformsToValue,
    accFix,
    accFixTags,
    language: checkLanguage(files),
    chapter: checkChapter(files),
    loiItems: loi.loiItems,
    loiFigcapMissing: loi.loiFigcapMissing,
    loiTocMissing: loi.loiTocMissing,
    loiImageDuplicates: loi.loiImageDuplicates,
    loiImageNumbers: loi.loiImageNumbers,
    loiFigurePreviews: loi.loiFigurePreviews,
    epubFilePaths: Object.keys(parsed.zip.files).filter((path) => !parsed.zip.files[path].dir),
    tocContent: checkTocContent(files),
    code: checkCodeStructure(files),
  };
  return { metadata, checks };
}
