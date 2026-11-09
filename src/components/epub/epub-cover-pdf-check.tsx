'use client';

import { useState } from 'react';
import JSZip from 'jszip';

type PdfTextItem = { str: string; transform: number[] };
type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }> };
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (input: { data: Uint8Array }) => { promise: Promise<PdfDocument> } };

type MatchRow = { text: string; matched: boolean; possible: boolean; page: number };
type Target = { file: string; text: string };
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
      for (const group of groups) {
        const line = group.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
        if (compact(line).length >= 5) lines.push({ page: pageNumber, text: line });
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
    const texts = [body?.textContent ?? '', ...Array.from(body?.querySelectorAll('img[alt]') ?? []).map((img) => img.getAttribute('alt') ?? '')];
    targets.push({ file: path.split('/').pop() ?? path, text: compact(texts.join(' ')) });
  }
  return targets;
}

function compare(lines: { page: number; text: string }[], targets: Target[]): MatchRow[] {
  const full = targets.map((target) => target.text).join('');
  return lines.map((line) => {
    const normalized = compact(line.text);
    const matched = targets.some((target) => target.text.includes(normalized)) || full.includes(normalized);
    const fragments = normalized.match(/.{5,12}/g) ?? [];
    const hits = fragments.filter((part) => full.includes(part)).length;
    return { ...line, matched, possible: !matched && fragments.length > 0 && hits / fragments.length >= 0.5 };
  });
}

export default function EpubCoverPdfCheck({ epubFile }: { epubFile: File }) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [showMatched, setShowMatched] = useState(false);
  const [ignored, setIgnored] = useState<number[]>([]);

  async function runCheck() {
    if (!pdfFile) return;
    setWorking(true);
    setError('');
    setRows(null);
    setIgnored([]);
    try {
      const [lines, epubTargets] = await Promise.all([extractCoverPdf(pdfFile), extractEpubCover(epubFile)]);
      if (!lines.length) throw new Error('PDF에서 선택 가능한 텍스트를 추출하지 못했습니다. 이미지 PDF는 OCR이 필요합니다.');
      setTargets(epubTargets);
      setRows(compare(lines, epubTargets));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '표지 대조 중 오류가 발생했습니다.');
    } finally {
      setWorking(false);
    }
  }

  const missing = rows?.filter((row, index) => !row.matched && !row.possible && !ignored.includes(index)).length ?? 0;
  const review = rows?.filter((row, index) => !row.matched && row.possible && !ignored.includes(index)).length ?? 0;
  const matched = rows?.filter((row) => row.matched).length ?? 0;

  return (
    <section className="epub-cover-pdf-check" style={{ border: '1px solid #d9e1e8', borderRadius: 12, padding: 20, marginTop: 24, background: '#fff' }}>
      <h3 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 8px' }}>표지 PDF · EPUB 텍스트 누락 검사</h3>
      <p style={{ color: '#526174', margin: '0 0 16px', lineHeight: 1.7 }}>
        표지 PDF의 텍스트를 cover / introduce / backcover / incover XHTML 본문 및 이미지 대체 텍스트와 대조합니다.
        글자 순서는 비교하지 않습니다. 일치하지 않는 줄은 누락 후보로 표시하며, 자동 수정하지 않습니다.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>표지 PDF</span>
          <input type="file" accept=".pdf,application/pdf" onChange={(event) => { setPdfFile(event.target.files?.[0] ?? null); setRows(null); setError(''); }} />
        </label>
        <button type="button" className="btn-primary" onClick={runCheck} disabled={!pdfFile || working}>{working ? '대조 중...' : '표지 누락 검사'}</button>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}
      {rows && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>PDF {rows.length}줄 분석 · 일치 {matched}줄 · 누락 후보 {missing}줄 · 부분 일치 {review}줄</p>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 10 }}>검사 대상: {targets.map((target) => target.file).join(', ')}</p>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={showMatched} onChange={(event) => setShowMatched(event.target.checked)} /> 일치한 문구도 보기
          </label>
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((row, index) => {
              if (row.matched && !showMatched) return null;
              return (
                <div key={index} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', background: ignored.includes(index) ? '#f8fafc' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                    <strong style={{ color: row.matched ? '#15803d' : row.possible ? '#a16207' : '#b91c1c', fontSize: 13 }}>
                      {row.matched ? '일치' : ignored.includes(index) ? '검토 제외' : row.possible ? '부분 일치 · 확인 필요' : '누락 후보'}
                    </strong>
                    <span style={{ color: '#64748b', fontSize: 12 }}>PDF {row.page}페이지</span>
                    {!row.matched && <button type="button" onClick={() => setIgnored((previous) => previous.includes(index) ? previous.filter((value) => value !== index) : [...previous, index])} style={{ marginLeft: 'auto', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', background: '#fff', cursor: 'pointer' }}>{ignored.includes(index) ? '검토 복원' : '의도적 생략'}</button>}
                  </div>
                  <div style={{ overflowWrap: 'anywhere', lineHeight: 1.6 }}>{row.text}</div>
                </div>
              );
            })}
          </div>
          <p style={{ marginTop: 14, color: '#64748b', fontSize: 13 }}>PDF의 글자 분할·줄바꿈, 책등·날개 구성, 이미지 안에만 존재하는 글자 때문에 오탐이 있을 수 있습니다. 누락 후보를 검토한 후 원본 XHTML을 확인하세요.</p>
        </div>
      )}
    </section>
  );
}
