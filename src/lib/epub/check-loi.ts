import JSZip from "jszip";
import type { LoiCheckResult } from "../../types/epub";
import { normalizeText, resolveRelativePath } from "./epub-utils";

interface XhtmlEntry { path: string; document: Document }
interface FigureInfo { file: string; id: string; caption: string; imagePaths: string[] }
interface LoiLinkInfo { href: string; targetFile: string; fragment: string; caption: string }

function isCover(path: string): boolean {
  return path.split("/").pop()?.toLowerCase() === "cover.xhtml";
}

function getFigureId(figcap: Element, figure: Element | null): string {
  return figure?.getAttribute("id") || figcap.getAttribute("id") || "";
}

function collectFigures(files: XhtmlEntry[]): FigureInfo[] {
  const result: FigureInfo[] = [];
  for (const file of files) {
    if (isCover(file.path)) continue;
    const captions = Array.from(file.document.querySelectorAll("figure p.figcap"));
    for (const caption of captions) {
      const figure = caption.closest("figure");
      const id = getFigureId(caption, figure);
      const imagePaths = figure
        ? Array.from(figure.querySelectorAll("img[src]"))
            .map((img) => img.getAttribute("src") ?? "")
            .filter(Boolean)
            .map((src) => resolveRelativePath(file.path, src.split("#")[0]))
        : [];
      result.push({ file: file.path, id, caption: normalizeText(caption.textContent), imagePaths });
    }
  }
  return result;
}

function collectLoiLinks(files: XhtmlEntry[]): { loiPath: string; links: LoiLinkInfo[] } {
  const loi = files.find((file) => file.path.split("/").pop()?.toLowerCase() === "loi.xhtml");
  if (!loi) return { loiPath: "", links: [] };
  const links = Array.from(loi.document.querySelectorAll('nav[epub\\:type="loi"] a[href], nav a[href]'))
    .map((anchor) => {
      const href = anchor.getAttribute("href") ?? "";
      const [pathPart, fragment = ""] = href.split("#", 2);
      return {
        href,
        targetFile: pathPart ? resolveRelativePath(loi.path, decodeURIComponent(pathPart)) : loi.path,
        fragment: decodeURIComponent(fragment),
        caption: normalizeText(anchor.textContent),
      };
    });
  return { loiPath: loi.path, links };
}

async function sha256(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const bytes = await file.async("uint8array");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export interface LoiChecks {
  loiItems: LoiCheckResult;
  loiImageDuplicates: LoiCheckResult;
  loiImageNumbers: LoiCheckResult;
}

export async function checkLoi(zip: JSZip, xhtmlFiles: XhtmlEntry[]): Promise<LoiChecks> {
  const figures = collectFigures(xhtmlFiles);
  const { links } = collectLoiLinks(xhtmlFiles);
  const matchedLinks = new Set<number>();
  const figureDetails: string[] = [];

  for (const figure of figures) {
    const index = links.findIndex((link, linkIndex) => {
      if (matchedLinks.has(linkIndex)) return false;
      const targetMatches = link.targetFile === figure.file && link.fragment === figure.id;
      return targetMatches && link.caption === figure.caption;
    });
    if (index >= 0) matchedLinks.add(index);
    else figureDetails.push(`누락: ${figure.file}#${figure.id} — ${figure.caption}`);
  }

  const extraLinks = links
    .map((link, index) => ({ link, index }))
    .filter(({ index }) => !matchedLinks.has(index));
  for (const { link } of extraLinks) figureDetails.push(`불필요한 LOI 링크: ${link.href} — ${link.caption}`);

  const loiItems: LoiCheckResult = {
    total: figures.length + links.length,
    matched: matchedLinks.size,
    unmatched: figureDetails.length,
    details: figureDetails,
  };

  const imageHashes = new Map<string, { file: string; figureId: string }[]>();
  for (const figure of figures) {
    for (const imagePath of figure.imagePaths) {
      const hash = await sha256(zip, imagePath);
      if (!hash) continue;
      if (!imageHashes.has(hash)) imageHashes.set(hash, []);
      imageHashes.get(hash)!.push({ file: imagePath, figureId: figure.id });
    }
  }

  const duplicateDetails: string[] = [];
  const numberDetails: string[] = [];
  for (const [hash, uses] of imageHashes) {
    if (uses.length > 1) {
      duplicateDetails.push(`동일 이미지 중복 사용: ${uses.map((use) => use.file).join(", ")} (${hash.slice(0, 12)})`);
      const ids = [...new Set(uses.map((use) => use.figureId).filter(Boolean))];
      if (ids.length > 1) numberDetails.push(`동일 이미지에 서로 다른 Figure ID 사용: ${ids.join(", ")} (${uses[0].file})`);
    }
  }

  return {
    loiItems,
    loiImageDuplicates: {
      total: imageHashes.size,
      matched: imageHashes.size - duplicateDetails.length,
      unmatched: duplicateDetails.length,
      details: duplicateDetails,
    },
    loiImageNumbers: {
      total: imageHashes.size,
      matched: imageHashes.size - numberDetails.length,
      unmatched: numberDetails.length,
      details: numberDetails,
    },
  };
}
