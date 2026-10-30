import type {
  EpubAnalysisResult, EpubMetadata, EpubMetadataChecks, FileCheckResult,
  TitleCheckResult, ChapterFailureDetail,
} from "../../types/epub";
import { parseEpub } from "./parse-epub";
import { getFileName, normalizeText } from "./epub-utils";
import { checkLoi } from "./check-loi";
import { readEpubMetadata } from "./check-metadata";

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const EPUB_NS = "http://www.idpf.org/2007/ops";
const EXPECTED_CONFORMS_TO = "EPUB Accessibility 1.1 - WCAG 2.2 Level AA";
const EXCLUDED_TITLE_FILES = ["loi.xhtml", "toc.xhtml", "lot.xhtml", "cover.xhtml"];
const EXCLUDED_CHAPTER_FILES = [
  "cover.xhtml", "incover.xhtml", "loi.xhtml", "copyright.xhtml", "incover2.xhtml",
  "toc.xhtml", "introduce.xhtml", "backcover.xhtml", "preface.xhtml",
  "preface1.xhtml", "preface2.xhtml", "preface3.xhtml", "preface4.xhtml",
  "preface5.xhtml", "preface6.xhtml", "preface7.xhtml", "preface8.xhtml", "preface9.xhtml",
];

function findFile(files: { path: string; document: Document }[], name: string) {
  return files.find((file) => getFileName(file.path) === name);
}
function bodyText(document: Document): string { return normalizeText(document.body?.textContent); }
function containsMetadataText(document: Document | undefined, value: string): boolean {
  return Boolean(value && document && bodyText(document).includes(value));
}
function imageAltMatches(document: Document | undefined, value: string): number {
  if (!document || !value) return 0;
  return Array.from(document.querySelectorAll("img[alt]"))
    .filter((image) => (image.getAttribute("alt") ?? "").includes(value)).length;
}
function checkTitleXhtml(files: { path: string; document: Document }[], title: string): TitleCheckResult {
  const targets = files.filter((file) => !EXCLUDED_TITLE_FILES.includes(getFileName(file.path)));
  const unmatchedFiles = targets.filter((file) => normalizeText(file.document.querySelector("title")?.textContent) !== title).map((file) => file.path);
  return {
    total: targets.length, matched: targets.length - unmatchedFiles.length,
    unmatched: unmatchedFiles.length, excluded: [...EXCLUDED_TITLE_FILES], unmatchedFiles,
  };
}
function checkLanguage(files: { path: string; document: Document }[]): FileCheckResult {
  const unmatchedFiles = files.filter(({ document }) => {
    const root = document.documentElement;
    return root.getAttribute("lang") !== "ko" || root.getAttributeNS(XML_NS, "lang") !== "ko";
  }).map((file) => file.path);
  return { total: files.length, matched: files.length - unmatchedFiles.length, unmatched: unmatchedFiles.length, unmatchedFiles };
}
function checkChapter(files: { path: string; document: Document }[]): FileCheckResult {
  const contentIndex = files.findIndex((file) => getFileName(file.path) === "content.xhtml");
  const ordered = contentIndex >= 0 ? files.slice(contentIndex) : files;
  const targets = ordered.filter((file) => !EXCLUDED_CHAPTER_FILES.includes(getFileName(file.path)));
  let total = 0;
  let matched = 0;
  const unmatchedFiles: string[] = [];
  const unmatchedDetails: ChapterFailureDetail[] = [];

  for (const file of targets) {
    const body = file.document.body;
    const sections = body ? Array.from(body.children).filter((child) => child.tagName.toLowerCase() === "section") : [];
    if (sections.length === 0) {
      total += 1;
      unmatchedFiles.push(file.path);
      unmatchedDetails.push({ file: file.path, sectionIndex: 0, epubType: null, role: null, reasons: ["body 바로 아래에 section 요소가 없습니다."], html: body?.innerHTML ?? "" });
      continue;
    }
    sections.forEach((section, index) => {
      total += 1;
      const epubType = section.getAttributeNS(EPUB_NS, "type") ?? section.getAttribute("epub:type");
      const role = section.getAttribute("role");
      const reasons: string[] = [];
      if (epubType !== "chapter") reasons.push('epub:type이 "chapter"가 아닙니다.');
      if (role !== "doc-chapter") reasons.push('role이 "doc-chapter"가 아닙니다.');
      if (reasons.length === 0) matched += 1;
      else {
        if (!unmatchedFiles.includes(file.path)) unmatchedFiles.push(file.path);
        unmatchedDetails.push({ file: file.path, sectionIndex: index + 1, epubType, role, reasons, html: section.outerHTML });
      }
    });
  }
  return { total, matched, unmatched: total - matched, unmatchedFiles, unmatchedDetails };
}

export async function analyzeEpub(file: File): Promise<EpubAnalysisResult> {
  const parsed = await parseEpub(file);
  const files = parsed.xhtmlFiles;
  const metadata: EpubMetadata = readEpubMetadata(parsed.metadataElement);
  const { title, creator } = metadata;

  const cover = findFile(files, "cover.xhtml");
  const copyright = findFile(files, "copyright.xhtml");
  const introduce = findFile(files, "introduce.xhtml");
  const conforms = Array.from(parsed.metadataElement.getElementsByTagName("meta"));
  const conformsTo = conforms.some((element) => element.getAttribute("property") === "dcterms:conformsTo" && normalizeText(element.textContent) === EXPECTED_CONFORMS_TO);
  const accFix = !conforms.some((element) => `${element.getAttribute("property") ?? ""} ${element.getAttribute("name") ?? ""}`.toLowerCase().includes("acc-fix"));
  const loi = await checkLoi(parsed.zip, files);

  const checks: EpubMetadataChecks = {
    titleXhtml: checkTitleXhtml(files, title),
    coverTitle: { exists: imageAltMatches(cover?.document, title) > 0, count: imageAltMatches(cover?.document, title) },
    copyrightTitle: { exists: containsMetadataText(copyright?.document, title), count: Number(containsMetadataText(copyright?.document, title)) },
    coverCreator: { exists: imageAltMatches(cover?.document, creator) > 0, count: imageAltMatches(cover?.document, creator) },
    introduceCreator: { exists: containsMetadataText(introduce?.document, creator), count: Number(containsMetadataText(introduce?.document, creator)) },
    copyrightCreator: { exists: containsMetadataText(copyright?.document, creator), count: Number(containsMetadataText(copyright?.document, creator)) },
    conformsTo, accFix, language: checkLanguage(files), chapter: checkChapter(files),
    loiItems: loi.loiItems, loiImageDuplicates: loi.loiImageDuplicates, loiImageNumbers: loi.loiImageNumbers,
  };
  return { metadata, checks };
}
