import type { TocContentCheckResult, TocContentEntry, TocContentIssue } from '../../types/epub';
import { getFileName } from './epub-utils';

const EPUB_NS = 'http://www.idpf.org/2007/ops';

type XhtmlFile = {
  path: string;
  document: Document;
};

const EXCLUDED_TITLES = ['이 책에 글을 쓴 작가들을 소개해요!', '판권지', '글의 순서'];

// 실제 비교에 사용하는 텍스트 정리
// 별표, 특수문자, 문장부호는 보존합니다.
function normalizeComparedText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// 항목의 대응 위치를 찾을 때만 사용하는 정규화
// 맨 앞의 불릿만 제거합니다.
function normalizeForAlignment(value: string): string {
  return normalizeComparedText(value)
    .replace(/^[\s\u00A0]*[•●○◦▪▫■□◆◇‣⁃∙·]+\s*/u, '')
    .trim();
}

// 파일 이름으로 XHTML 파일 찾기
function findFile(files: XhtmlFile[], name: string): XhtmlFile | undefined {
  return files.find((file) => getFileName(file.path).toLowerCase() === name.toLowerCase());
}

// 기준 요소 뒤에 대상 요소가 있는지 확인
function isAfterNode(marker: Element, target: Element): boolean {
  return Boolean(marker.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// 시작 제목 찾기
function findStartHeading(document: Document, title: string): Element | undefined {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));

  return headings.find((heading) => {
    const text = normalizeComparedText(heading.textContent);

    return text === title || text.startsWith(`${title} `);
  });
}

// TOC에서 제외할 항목인지 확인
function isExcludedTocEntry(text: string, href: string): boolean {
  const normalizedText = normalizeComparedText(text);

  const cleanHref = href.replace(/\\/g, '/').split('?')[0];

  const fileName = cleanHref.split('#')[0].split('/').pop()?.toLowerCase();

  const fragment = cleanHref.includes('#') ? cleanHref.split('#')[1].toLowerCase() : '';

  // 작가 소개 제외
  if (
    fileName === 'introduce.xhtml' &&
    (fragment === 'h0001' || normalizedText === EXCLUDED_TITLES[0])
  ) {
    return true;
  }

  // 판권지 제외
  if (
    fileName === 'copyright.xhtml' &&
    (fragment === 'h0002' || normalizedText === EXCLUDED_TITLES[1])
  ) {
    return true;
  }

  // content.xhtml의 글의 순서 제외
  if (fileName === 'content.xhtml' && normalizedText === EXCLUDED_TITLES[2]) {
    return true;
  }

  return false;
}

// CONTENT에서 제외할 항목인지 확인
function isExcludedContentEntry(text: string): boolean {
  return normalizeComparedText(text) === '글의 순서';
}

// 상대 경로 생성
function relativeHref(fromFile: string, targetFile: string, id: string): string {
  const fromParts = fromFile.split('/');
  fromParts.pop();

  const targetParts = targetFile.split('/');

  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  const path = [...fromParts.map(() => '..'), ...targetParts].join('/');

  return `${path || getFileName(targetFile)}#${encodeURIComponent(id)}`;
}

// 각주 표시를 제외한 제목 텍스트
function headingTextWithoutNoteMarkers(element: Element): string {
  const clone = element.cloneNode(true) as Element;

  clone.querySelectorAll('sup.note').forEach((note) => note.remove());

  return normalizeComparedText(clone.textContent);
}

// CONTENT의 실제 제목 위치 찾기
function resolveContentTarget(
  text: string,
  contentPath: string,
  files: XhtmlFile[],
): string | undefined {
  const normalized = normalizeComparedText(text);

  if (!normalized) return undefined;

  for (const file of files) {
    if (getFileName(file.path).toLowerCase() === 'toc.xhtml') {
      continue;
    }

    const headings = Array.from(file.document.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    const match = headings.find((heading) => {
      return (
        normalizeComparedText(heading.textContent) === normalized ||
        headingTextWithoutNoteMarkers(heading) === normalized
      );
    });

    const id = match?.getAttribute('id') ?? match?.querySelector('[id]')?.getAttribute('id');

    if (match && id) {
      return relativeHref(contentPath, file.path, id);
    }
  }

  return undefined;
}

// TOC 항목 수집
function collectTocEntries(tocFile: XhtmlFile): TocContentEntry[] {
  const nav =
    tocFile.document.querySelector('nav#toc') ??
    Array.from(tocFile.document.getElementsByTagNameNS(EPUB_NS, 'nav')).find(
      (element) => element.getAttributeNS(EPUB_NS, 'type') === 'toc',
    ) ??
    tocFile.document.querySelector("nav[epub\\:type='toc']");

  if (!nav) return [];

  // 차례 제목 이후부터 수집
  const startHeading = findStartHeading(tocFile.document, '차례');

  const anchors = Array.from(nav.querySelectorAll('ol a[href]'));

  const filtered = anchors.filter((anchor) => {
    const href = anchor.getAttribute('href') ?? '';

    const text = normalizeComparedText(anchor.textContent);

    if (startHeading && !isAfterNode(startHeading, anchor)) {
      return false;
    }

    return !isExcludedTocEntry(text, href);
  });

  return filtered.map((anchor, index) => {
    const href = anchor.getAttribute('href') ?? '';

    const currentLi = anchor.closest('li');

    const parentLi = currentLi?.parentElement?.closest('li') ?? null;

    const parentAnchor = parentLi?.querySelector(':scope > a[href]');

    const sameListAnchors = Array.from(
      anchor.closest('ol')?.querySelectorAll(':scope > li > a[href]') ?? [],
    ).filter((item) => {
      const itemHref = item.getAttribute('href') ?? '';

      const itemText = normalizeComparedText(item.textContent);

      return !isExcludedTocEntry(itemText, itemHref);
    });

    const localIndex = sameListAnchors.indexOf(anchor);

    return {
      index,

      text: normalizeComparedText(anchor.textContent),

      href,

      parentPartText: parentAnchor ? normalizeComparedText(parentAnchor.textContent) : undefined,

      previousText:
        localIndex > 0
          ? normalizeComparedText(sameListAnchors[localIndex - 1].textContent)
          : undefined,

      nextText:
        localIndex >= 0 && localIndex < sameListAnchors.length - 1
          ? normalizeComparedText(sameListAnchors[localIndex + 1].textContent)
          : undefined,

      previousHref:
        localIndex > 0
          ? (sameListAnchors[localIndex - 1].getAttribute('href') ?? undefined)
          : undefined,

      nextHref:
        localIndex >= 0 && localIndex < sameListAnchors.length - 1
          ? (sameListAnchors[localIndex + 1].getAttribute('href') ?? undefined)
          : undefined,

      targetHref: href,
    };
  });
}

// CONTENT 항목 수집
function collectContentEntries(
  contentFile: XhtmlFile,
  tocPath: string,
  files: XhtmlFile[],
): TocContentEntry[] {
  // 글의 순서 제목을 시작점으로 사용
  const startHeading = findStartHeading(contentFile.document, '글의 순서');

  // toc_list2 추가
  // 먼저 전하는 이야기와 같은 별도 목차 항목을 수집합니다.
  const elements = Array.from(
    contentFile.document.querySelectorAll(
      ['h1.toc_h1', 'p.toc_title', 'p.toc_list', 'p.toc_list2'].join(', '),
    ),
  ).filter((element) => {
    const text = normalizeComparedText(element.textContent);

    // 글의 순서 제목 자체 제외
    if (isExcludedContentEntry(text)) {
      return false;
    }

    // 글의 순서 이전 항목 제외
    if (startHeading && !isAfterNode(startHeading, element)) {
      return false;
    }

    return true;
  });

  return elements.map((element, index) => {
    let parentPartText: string | undefined;

    if (element.classList.contains('toc_list')) {
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (elements[cursor].classList.contains('toc_title')) {
          parentPartText = normalizeComparedText(elements[cursor].textContent);
          break;
        }
      }
    }

    const text = normalizeComparedText(element.textContent);

    return {
      index,
      text,

      className: element.getAttribute('class') ?? undefined,

      tagName: element.tagName.toLowerCase(),

      parentPartText,

      previousText: index > 0 ? normalizeComparedText(elements[index - 1].textContent) : undefined,

      nextText:
        index < elements.length - 1
          ? normalizeComparedText(elements[index + 1].textContent)
          : undefined,

      targetHref: resolveContentTarget(text, tocPath, files),
    };
  });
}

// LCS 비교 테이블 생성
function buildLcsTable(
  tocEntries: TocContentEntry[],
  contentEntries: TocContentEntry[],
): number[][] {
  const rows = tocEntries.length + 1;
  const columns = contentEntries.length + 1;

  const dp = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const tocText = normalizeForAlignment(tocEntries[i - 1].text);

      const contentText = normalizeForAlignment(contentEntries[j - 1].text);

      if (tocText === contentText) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

// LCS를 이용해 같은 항목의 위치 찾기
function getMatchedPairs(
  tocEntries: TocContentEntry[],
  contentEntries: TocContentEntry[],
): Array<[number, number]> {
  const dp = buildLcsTable(tocEntries, contentEntries);

  const pairs: Array<[number, number]> = [];

  let i = tocEntries.length;
  let j = contentEntries.length;

  while (i > 0 && j > 0) {
    const tocText = normalizeForAlignment(tocEntries[i - 1].text);

    const contentText = normalizeForAlignment(contentEntries[j - 1].text);

    if (tocText === contentText) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return pairs.reverse();
}

// 일치 항목 사이의 누락 및 불일치 구간 처리
function appendGapIssues(
  issues: TocContentIssue[],
  tocGap: TocContentEntry[],
  contentGap: TocContentEntry[],
): void {
  const paired = Math.min(tocGap.length, contentGap.length);

  // 양쪽에 항목은 있지만 텍스트가 다른 경우
  for (let i = 0; i < paired; i += 1) {
    issues.push({
      id: `toc-content-${issues.length}`,
      kind: 'text',
      toc: tocGap[i],
      content: contentGap[i],
      canAddToToc: false,
      canAddToContent: false,
    });
  }

  // TOC에만 존재하는 항목
  for (let i = paired; i < tocGap.length; i += 1) {
    issues.push({
      id: `toc-content-${issues.length}`,
      kind: 'missing-in-content',
      toc: tocGap[i],
      content: null,
      canAddToToc: false,
      canAddToContent: Boolean(tocGap[i].href),
    });
  }

  // CONTENT에만 존재하는 항목
  for (let i = paired; i < contentGap.length; i += 1) {
    issues.push({
      id: `toc-content-${issues.length}`,
      kind: 'missing-in-toc',
      toc: null,
      content: contentGap[i],
      canAddToToc: Boolean(contentGap[i].targetHref),
      canAddToContent: false,
    });
  }
}

// 순서 기반 비교
function buildIssues(
  tocEntries: TocContentEntry[],
  contentEntries: TocContentEntry[],
): TocContentIssue[] {
  const matchedPairs = getMatchedPairs(tocEntries, contentEntries);

  const issues: TocContentIssue[] = [];

  let previousTocIndex = -1;
  let previousContentIndex = -1;

  for (const [tocIndex, contentIndex] of matchedPairs) {
    const tocGap = tocEntries.slice(previousTocIndex + 1, tocIndex);

    const contentGap = contentEntries.slice(previousContentIndex + 1, contentIndex);

    appendGapIssues(issues, tocGap, contentGap);

    const toc = tocEntries[tocIndex];
    const content = contentEntries[contentIndex];

    // 불릿을 제외한 텍스트로 항목을 찾았지만
    // 원문이 다르면 실제 불일치로 표시합니다.
    if (toc.text !== content.text) {
      issues.push({
        id: `toc-content-${issues.length}`,
        kind: 'text',
        toc,
        content,
        canAddToToc: false,
        canAddToContent: false,
      });
    }

    previousTocIndex = tocIndex;
    previousContentIndex = contentIndex;
  }

  // 마지막 일치 항목 이후의 나머지 비교
  const remainingToc = tocEntries.slice(previousTocIndex + 1);

  const remainingContent = contentEntries.slice(previousContentIndex + 1);

  appendGapIssues(issues, remainingToc, remainingContent);

  return issues;
}

// 외부에서 호출하는 검사 함수
export function checkTocContent(files: XhtmlFile[]): TocContentCheckResult {
  const tocFile = findFile(files, 'toc.xhtml');

  const contentFile = findFile(files, 'content.xhtml');

  if (!tocFile || !contentFile) {
    return {
      total: 0,
      matched: 0,
      unmatched: 1,
      issues: [],
      error: `${!tocFile ? 'toc.xhtml' : 'content.xhtml'} 파일을 찾을 수 없습니다.`,
    };
  }

  const tocEntries = collectTocEntries(tocFile);

  const contentEntries = collectContentEntries(contentFile, tocFile.path, files);

  const issues = buildIssues(tocEntries, contentEntries);

  const total = Math.max(tocEntries.length, contentEntries.length);

  return {
    total,
    matched: Math.max(0, total - issues.length),
    unmatched: issues.length,
    issues,
  };
}
