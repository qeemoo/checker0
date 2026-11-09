'use client';

import { useEffect, useState } from 'react';
import JSZip from 'jszip';

type PdfTextItem = { str: string; transform: number[] };
type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }> };
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (input: { data: Uint8Array }) => { promise: Promise<PdfDocument> } };

type CoverSection = 'cover' | 'introduce' | 'backcover';
type MatchRow = { text: string; page: number };
type Target = { file: string; phrases: { text: string; source: '본문' | 'alt' }[] };
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const COVER_FILES = /(?:^|\/)(?:cover|introduce|backcover|incover|incover2)\.xhtml$/i;

function compact(value: string): string {
  return value.normalize('NFKC').replace(/[\u200b-\u200d\ufeff\u00ad]/g, '').replace(/\s+/g, '').replace(/[“”"‘’']/g, '').trim();
}

async function loadPdfJs(): Promise<PdfJs> {
  const global = window as Window & { pdfjsLib?: PdfJs };
  if (global.pdfjsLib) return global.pdfjsLib;
  const existing = document.querySelector<HTMLScriptElement>('script[data-cover-pdfjs]');
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      if (global.pdfjsLib) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('PDF 분석 라이브러리를 불러오지 못했습니다.')), { once: true });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDFJS_URL;
      script.async = true;
      script.dataset.coverPdfjs = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('PDF 분석 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.'));
      document.head.appendChild(script);
    });
  }
  const pdfjs = (window as Window & { pdfjsLib?: PdfJs }).pdfjsLib;
  if (!pdfjs) throw new Error('PDF 분석 라이브러리를 초기화하지 못했습니다.');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs;
}

async function extractCoverPdf(file: File): Promise<{ page: number; text: string }[]> {
  const pdfjs = await loadPdfJs();
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: { page: number; text: string }[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const groups: { y: number; items: { x: number; text: string }[] }[] = [];
      for (const item of content.items) {
        const value = item.str?.trim();
        if (!value) continue;
        const x = item.transform?.[4] ?? 0;
        const y = item.transform?.[5] ?? 0;
        let group = groups.find((candidate) => Math.abs(candidate.y - y) < 2);
        if (!group) {
          group = { y, items: [] };
          groups.push(group);
        }
        group.items.push({ x, text: value });
      }
      // PDF.js 텍스트 항목의 반환 순서는 화면의 읽기 순서와 다를 수 있습니다.
      // 위에서 아래로 정렬해야 '순' + 줄바꿈 + '간'을 '순간'으로 복원할 수 있습니다.
      for (const group of groups.sort((a, b) => b.y - a.y)) {
        const line = group.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
        if (compact(line).length >= 1) lines.push({ page: pageNumber, text: line });
      }
    }
  } finally {
    await pdf.destroy();
  }
  return lines;
}

async function extractEpubCover(file: File): Promise<Target[]> {
  const zip = await JSZip.loadAsync(file);
  const paths = Object.keys(zip.files).filter((path) => COVER_FILES.test(path));
  if (!paths.length) throw new Error('EPUB에서 표지 관련 XHTML을 찾지 못했습니다.');
  const targets: Target[] = [];
  for (const path of paths) {
    const xml = await zip.files[path].async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) throw new Error(path + ' 파일의 XHTML을 읽을 수 없습니다.');
    const body = doc.querySelector('body');
    const phrases: Target['phrases'] = [];
    if (body) {
      const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,svg')) continue;
        const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (compact(text)) phrases.push({ text, source: '본문' });
      }
      for (const img of Array.from(body.querySelectorAll('img[alt]'))) {
        const text = img.getAttribute('alt')?.trim() ?? '';
        if (compact(text) && !/^(앞표지|뒤표지|표지|커버)$/u.test(compact(text))) phrases.push({ text, source: 'alt' });
      }
    }
    targets.push({ file: path.split('/').pop() ?? path, phrases });
  }
  return targets;
}

function words(value: string): string[] {
  return value.normalize('NFKC').split(/[\s|｜·•,，、/()[\]{}]+/u).map(compact).filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return previous[b.length];
}

function evaluate(lines: MatchRow[], target?: Target) {
  // 줄 끝에서 강제로 잘린 단어는 PDF의 다음 줄과 이어서 검사합니다.
  const pageTexts = [...new Set(lines.map((line) => line.page))].map((page) => lines.filter((line) => line.page === page).map((line) => compact(line.text)).join(''));
  const pdfWords = lines.flatMap((line) => words(line.text));
  return (target?.phrases ?? []).flatMap((phrase) => {
    const tokens = words(phrase.text);
    if (!tokens.length) return [];
    // PDF 문구는 페이지에서 떨어져 있어도 단어별로 대조한다.
    const missing = tokens.filter((token) => !pageTexts.some((text) => text.includes(token)) && !pdfWords.some((word) => word.includes(token)));
    const suggestions = missing.map((token) => {
      const near = pdfWords.find((word) => word.length >= 2 && editDistance(token, word) <= (token.length >= 5 ? 2 : 1));
      return { token, near };
    });
    return [{ ...phrase, matched: missing.length === 0, missing: suggestions }];
  });
}

export default function EpubCoverPdfCheck({ epubFile, section, coverPdf }: { epubFile: File; section?: CoverSection; coverPdf?: File | null }) {
  const [pdfFile, setPdfFile] = useState<File | null>(coverPdf ?? null);
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [selectedSection, setSelectedSection] = useState<CoverSection>('cover');
  useEffect(() => { if (section) setSelectedSection(section); }, [section]);
  const sections: { id: CoverSection; label: string; file: string }[] = [
    { id: 'cover', label: '앞표지', file: 'cover.xhtml' },
    { id: 'introduce', label: '앞·뒤날개', file: 'introduce.xhtml' },
    { id: 'backcover', label: '뒤표지', file: 'backcover.xhtml' },
  ];

  async function runCheck(file = pdfFile) {
    if (!file) return;
    setWorking(true);
    setError('');
    setRows(null);
    try {
      const [lines, epubTargets] = await Promise.all([extractCoverPdf(file), extractEpubCover(epubFile)]);
      if (!lines.length) throw new Error('PDF에서 선택 가능한 텍스트를 추출하지 못했습니다. 이미지 PDF는 OCR이 필요합니다.');
      setTargets(epubTargets);
      setRows(lines);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '표지 대조 중 오류가 발생했습니다.');
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!coverPdf) return;
    let active = true;
    setWorking(true);
    setError('');
    Promise.all([extractCoverPdf(coverPdf), extractEpubCover(epubFile)])
      .then(([lines, epubTargets]) => {
        if (!active) return;
        if (!lines.length) throw new Error('PDF에서 텍스트를 추출하지 못했습니다. 이미지 PDF는 OCR이 필요합니다.');
        setTargets(epubTargets);
        setRows(lines);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'PDF 검사 실패'); })
      .finally(() => { if (active) setWorking(false); });
    return () => { active = false; };
  }, [coverPdf, epubFile]);

  const currentFile = sections.find((item) => item.id === selectedSection)?.file;
  const target = targets.find((item) => item.file.toLowerCase() === currentFile);
  const results = evaluate(rows ?? [], target);
  const allMatched = Boolean(rows && target && results.every((row) => row.matched));
  const failures = results.filter((row) => !row.matched);

  return (
    <section className="epub-cover-pdf-check">
      <h3>{selectedSection === 'introduce' ? '소개' : selectedSection === 'backcover' ? '뒤표지' : '커버'} PDF 대조</h3>
      <div className="cover-pdf-actions">
        {!coverPdf && <label className="cover-pdf-file-label">PDF 선택
          <input type="file" accept=".pdf,application/pdf" onChange={(event) => { setPdfFile(event.target.files?.[0] ?? null); setRows(null); setError(''); }} />
        </label>}
        {!coverPdf && <button type="button" className="btn-primary" disabled={!pdfFile || working} onClick={() => void runCheck()}>{working ? '검사 중...' : '검사'}</button>}
      </div>
      {error && <p className="status-failure" role="alert">{error}</p>}
      {rows && (
        <div className="cover-pdf-results">
          <div className="cover-pdf-summary">
            <strong className={allMatched ? 'status-success' : 'status-failure'}>{allMatched ? 'O' : 'X'}</strong>
            <span>{currentFile}</span>
            <span>{allMatched ? 'EPUB 문구 모두 확인' : target ? `누락 문구 ${failures.length}건` : 'XHTML 파일 없음'}</span>
          </div>
          {!allMatched && failures.map((row, index) => (
            <div className="cover-pdf-issue" key={index}>
              <strong className="status-failure">X</strong>
              <span>{row.missing.map((item) => item.near ? `${item.token} (PDF 유사 문구: ${item.near})` : item.token).join(' · ')}</span>
              <small>EPUB {row.source} 원문: {row.text}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
