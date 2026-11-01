import JSZip from 'jszip';
import type { LoiCheckResult } from '../../types/epub';
import { normalizeText, resolveRelativePath } from './epub-utils';

interface XhtmlEntry { path: string; document: Document }
interface FigureParagraph { file: string; id: string; caption: string; hasFigcap: boolean; imagePaths: string[] }
interface LoiLinkInfo { href: string; targetFile: string; fragment: string; caption: string }

function isCover(path: string): boolean { return path.split('/').pop()?.toLowerCase() === 'cover.xhtml'; }
function cleanName(path: string): string { return path.replace(/^OEBPS\//i, ''); }
function compact(value: string): string { return normalizeText(value).replace(/[\s\u00a0]+/g, '').toLocaleLowerCase(); }

function collectFigureParagraphs(files: XhtmlEntry[]): FigureParagraph[] {
  const result: FigureParagraph[] = [];
  for (const file of files) {
    if (isCover(file.path)) continue;
    for (const figure of Array.from(file.document.querySelectorAll('figure'))) {
      const imagePaths = Array.from(figure.querySelectorAll('img[src]'))
        .map((img) => img.getAttribute('src') ?? '')
        .filter(Boolean)
        .map((src) => {
          const raw = src.split('#')[0].split('?')[0];
          try { return resolveRelativePath(file.path, decodeURIComponent(raw)); }
          catch { return resolveRelativePath(file.path, raw); }
        });
      for (const paragraph of Array.from(figure.querySelectorAll('p'))) {
        const classNames = (paragraph.getAttribute('class') ?? '').split(/\s+/);
        result.push({
          file: file.path,
          id: paragraph.getAttribute('id') ?? '',
          caption: normalizeText(paragraph.textContent),
          hasFigcap: classNames.includes('figcap') || classNames.includes('figacp'),
          imagePaths,
        });
      }
    }
  }
  return result;
}

function collectLoiLinks(files: XhtmlEntry[]): { loiPath: string; links: LoiLinkInfo[] } {
  const loi = files.find((file) => file.path.split('/').pop()?.toLowerCase() === 'loi.xhtml');
  if (!loi) return { loiPath: '', links: [] };
  const navs = Array.from(loi.document.querySelectorAll('nav')).filter((nav) => {
    const type = nav.getAttribute('epub:type') ?? nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '';
    return type.split(/\s+/).includes('loi');
  });
  const anchors = navs.flatMap((nav) => Array.from(nav.querySelectorAll('a[href]')));
  const links = anchors.map((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    const [pathPart, fragment = ''] = href.split('#', 2);
    let targetFile = loi.path;
    let decodedFragment = fragment;
    try { targetFile = pathPart ? resolveRelativePath(loi.path, decodeURIComponent(pathPart)) : loi.path; } catch { targetFile = pathPart ? resolveRelativePath(loi.path, pathPart) : loi.path; }
    try { decodedFragment = decodeURIComponent(fragment); } catch { /* retain original fragment */ }
    return { href, targetFile, fragment: decodedFragment, caption: normalizeText(anchor.textContent) };
  }).filter((link) => !isCover(link.targetFile));
  return { loiPath: loi.path, links };
}

async function sha256(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const bytes = await file.async('uint8array');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function result(details: string[], total: number): LoiCheckResult {
  return { total, matched: Math.max(0, total - details.length), unmatched: details.length, details };
}

export interface LoiChecks {
  loiItems: LoiCheckResult;
  loiFigcapMissing: LoiCheckResult;
  loiTocMissing: LoiCheckResult;
  loiImageDuplicates: LoiCheckResult;
  loiImageNumbers: LoiCheckResult;
  loiFigurePreviews: { xhtmlFile: string; file: string; imagePaths: string[]; caption: string; imageDataUrl: string; id: string; hasIssue?: boolean }[];
}

export async function checkLoi(zip: JSZip, xhtmlFiles: XhtmlEntry[]): Promise<LoiChecks> {
  const paragraphs = collectFigureParagraphs(xhtmlFiles);
  const { links } = collectLoiLinks(xhtmlFiles);
  const idMissing: string[] = [];
  const figcapMissing: string[] = [];
  const tocMissing: string[] = [];
  const issueKeys = new Set<string>();
  const paragraphKey = (item: FigureParagraph) => `${item.file}|${item.id}|${item.caption}`;

  // 1) ID 누락: figure 안의 p 요소에 ID가 없는 경우만 검사합니다.
  for (const item of paragraphs) {
    if (!item.id.trim()) {
      idMissing.push(`${cleanName(item.file)}\n${item.caption || '(내용 없음)'}\nfigure 내부 p 태그에 ID가 없습니다.`);
      issueKeys.add(paragraphKey(item));
    }
  }

  // 2) figcap 누락: figure 안의 p 요소에 figcap 클래스가 없는 경우를 검사합니다.
  for (const item of paragraphs) {
    if (!item.hasFigcap) {
      figcapMissing.push(`${cleanName(item.file)}${item.id ? `#${item.id}` : ''}\n${item.caption || '(내용 없음)'}\nfigure 내부 p 태그에 figcap 클래스가 없습니다.`);
      issueKeys.add(paragraphKey(item));
    }
  }

  // 3) 목차 누락: figcap과 ID가 모두 있는 p만 LOI 링크의 파일·ID·내용과 비교합니다.
  const eligible = paragraphs.filter((item) => item.hasFigcap && item.id.trim());
  const consumedLinks = new Set<number>();
  for (const item of eligible) {
    const key = paragraphKey(item);
    const linkIndex = links.findIndex((link, index) => !consumedLinks.has(index) && link.targetFile === item.file && link.fragment === item.id);
    if (linkIndex < 0) {
      const imageNames = item.imagePaths.map((path) => path.split('/').pop() ?? path);
      tocMissing.push(`${cleanName(item.file)}#${item.id}${imageNames.length ? ` (${imageNames.join(', ')})` : ''}\n${item.caption || '(figcap 텍스트 없음)'}`);
      issueKeys.add(key);
      continue;
    }
    consumedLinks.add(linkIndex);
    if (links[linkIndex].caption !== item.caption) {
      const imageNames = item.imagePaths.map((path) => path.split('/').pop() ?? path);
      tocMissing.push(`${cleanName(item.file)}#${item.id}${imageNames.length ? ` (${imageNames.join(', ')})` : ''}\n${item.caption || '(figcap 텍스트 없음)'}\nLOI 설명과 본문 figcap 내용이 일치하지 않습니다.`);
      issueKeys.add(key);
    }
  }
  links.forEach((link, index) => {
    if (!consumedLinks.has(index)) tocMissing.push(`${cleanName(link.targetFile)}${link.fragment ? `#${link.fragment}` : ''}\n${link.caption}\n본문 figure의 p 태그에 대응하는 항목이 없습니다.`);
  });

  // 이미지 목차 목록은 LOI에 기록된 순서를 유지합니다.
  const previews: LoiChecks['loiFigurePreviews'] = [];
  for (const link of links) {
    const paragraph = eligible.find((item) => item.file === link.targetFile && item.id === link.fragment);
    if (!paragraph || !paragraph.imagePaths.length) continue;
    const imagePath = paragraph.imagePaths[0];
    const imageFile = zip.file(imagePath);
    if (!imageFile) continue;
    const extension = imagePath.split('.').pop()?.toLowerCase() ?? '';
    const mime = extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : extension === 'svg' ? 'image/svg+xml' : extension === 'avif' ? 'image/avif' : extension === 'bmp' ? 'image/bmp' : 'image/jpeg';
    const base64 = await imageFile.async('base64');
    previews.push({ xhtmlFile: paragraph.file, file: imagePath, imagePaths: paragraph.imagePaths, caption: paragraph.caption, id: paragraph.id, imageDataUrl: `data:${mime};base64,${base64}`, hasIssue: issueKeys.has(paragraphKey(paragraph)) });
  }

  // 중복 검사 1: figure 내부 img src 경로 중복
  const pathUses = new Map<string, FigureParagraph[]>();
  for (const item of eligible) for (const path of new Set(item.imagePaths)) pathUses.set(path, [...(pathUses.get(path) ?? []), item]);
  const duplicateDetails: string[] = [];
  for (const [path, uses] of pathUses) {
    if (uses.length < 2) continue;
    duplicateDetails.push(`이미지 경로 중복\n${cleanName(path)}\n${[...new Set(uses.map((item) => `${cleanName(item.file)}#${item.id}`))].join('\n')}`);
    for (const item of uses) issueKeys.add(paragraphKey(item));
  }

  // 중복 검사 2: figcap 텍스트 중복
  const captionGroups = new Map<string, FigureParagraph[]>();
  for (const item of eligible) {
    const normalized = compact(item.caption);
    if (normalized) captionGroups.set(normalized, [...(captionGroups.get(normalized) ?? []), item]);
  }
  for (const uses of captionGroups.values()) {
    if (uses.length < 2) continue;
    duplicateDetails.push(`이미지 설명 중복\n${uses[0].caption}\n${uses.map((item) => `${cleanName(item.file)}#${item.id}`).join('\n')}`);
    for (const item of uses) issueKeys.add(paragraphKey(item));
  }

  // 중복 검사 3: 파일명이 다르지만 실제 이미지 바이트가 같은 경우
  const hashUses = new Map<string, string[]>();
  for (const path of pathUses.keys()) {
    const hash = await sha256(zip, path);
    if (hash) hashUses.set(hash, [...(hashUses.get(hash) ?? []), path]);
  }
  for (const paths of hashUses.values()) {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length < 2) continue;
    duplicateDetails.push(`이미지 파일 중복\n${uniquePaths.map(cleanName).join('\n')}`);
    for (const path of uniquePaths) for (const item of pathUses.get(path) ?? []) issueKeys.add(paragraphKey(item));
  }

  for (const preview of previews) preview.hasIssue = issueKeys.has(`${preview.xhtmlFile}|${preview.id}|${preview.caption}`);
  return {
    loiItems: result(tocMissing, eligible.length + links.length),
    loiFigcapMissing: result(figcapMissing, paragraphs.length),
    loiTocMissing: result(tocMissing, eligible.length + links.length),
    loiImageDuplicates: result(duplicateDetails, pathUses.size + captionGroups.size + hashUses.size),
    loiImageNumbers: result(idMissing, paragraphs.length),
    loiFigurePreviews: previews,
  };
}
