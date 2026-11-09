'use client';

import { useState } from 'react';
import JSZip from 'jszip';

type PdfTextItem = { str: string; transform: number[] };
type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }> };
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (input: { data: Uint8Array }) => { promise: Promise<PdfDocument> } };

type CoverSection = 'cover' | 'introduce' | 'backcover';
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
  const [assignments, setAssignments] = useState<Record<number, CoverSection | 'unassigned'>>({});
  const [selectedSection, setSelectedSection] = useState<CoverSection>('cover');
  const sections: { id: CoverSection; label: string; file: string }[] = [
    { id: 'cover', label: '앞표지', file: 'cover.xhtml' },
    { id: 'introduce', label: '앞·뒤날개', file: 'introduce.xhtml' },
    { id: 'backcover', label: '뒤표지', file: 'backcover.xhtml' },
  ];

  async function runCheck() {
    if (!pdfFile) return;
    setWorking(true);
    setError('');
    setRows(null);
    setIgnored([]);
    setAssignments({});
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

  const sectionTargets = targets.filter((target) => target.file.toLowerCase() === sections.find((section) => section.id === selectedSection)?.file);
  const sectionRows = rows?.map((row, index) => ({ ...row, index, assigned: assignments[index] ?? 'unassigned' })).filter((row) => row.assigned === selectedSection) ?? [];
  const checkedRows = compare(sectionRows, sectionTargets);
  const missing = checkedRows.filter((row, index) => !row.matched && !row.possible && !ignored.includes(sectionRows[index].index)).length;
  const review = checkedRows.filter((row, index) => !row.matched && row.possible && !ignored.includes(sectionRows[index].index)).length;
  const matched = checkedRows.filter((row) => row.matched).length;

  return (
    <section className="epub-cover-pdf-check" style={{ border: '1px solid #d9e1e8', borderRadius: 12, padding: 20, marginTop: 24, background: '#fff' }}>
      <h3 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 8px' }}>표지 PDF · EPUB 텍스트 누락 검사</h3>
      <p style={{ color: '#526174', margin: '0 0 16px', lineHeight: 1.7 }}>
        PDF의 글자 순서가 일정하지 않으므로 추출된 문구를 앞표지·날개·뒤표지로 분류한 뒤 해당 XHTML과 각각 비교합니다.
        미분류 문구는 통과로 처리하지 않습니다. 이미지 안의 글자는 별도 확인이 필요합니다.
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
          <p style={{ fontSize: 13, color: '#64748b' }}>PDF에서 추출한 {rows.length}개 문구를 아래에서 분류하세요. 책등 문구는 앞표지로 분류하거나 검토 제외할 수 있습니다.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            {sections.map((section) => <button key={section.id} type="button" onClick={() => setSelectedSection(section.id)} className={selectedSection === section.id ? 'btn-primary' : 'btn-secondary'}>{section.label} ({rows.filter((_, index) => assignments[index] === section.id).length})</button>)}
          </div>
          <p style={{ fontWeight: 650 }}>대상: {sections.find((section) => section.id === selectedSection)?.file} · 일치 {matched} · 누락 후보 {missing} · 부분 일치 {review}</p>
          {sectionTargets.length === 0 && <p role="alert" style={{ color: '#b91c1c' }}>해당 XHTML이 EPUB에 없습니다. 자동 통과로 처리하지 않습니다.</p>}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '12px 0' }}><input type="checkbox" checked={showMatched} onChange={(event) => setShowMatched(event.target.checked)} /> 일치 문구도 표시</label>
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 650, padding: '10px 0' }}>PDF 문구 분류 · 미분류 {rows.filter((_, index) => !assignments[index] || assignments[index] === 'unassigned').length}건</summary>
            <div style={{ maxHeight: 330, overflowY: 'auto', display: 'grid', gap: 8 }}>
              {rows.map((row, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #e5e9e5', padding: '8px 0' }}>
                  <select aria-label={`PDF 문구 ${index + 1} 분류`} value={assignments[index] ?? 'unassigned'} onChange={(event) => setAssignments((previous) => ({ ...previous, [index]: event.target.value as CoverSection | 'unassigned' }))} style={{ minWidth: 115, padding: 6, border: '1px solid #dce3dc', borderRadius: 6 }}>
                    <option value="unassigned">미분류</option>
                    {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
                  </select>
                  <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{row.text}</span>
                </div>
              ))}
            </div>
          </details>
          <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
            {sectionRows.map((row, localIndex) => {
              const result = checkedRows[localIndex];
              if (result.matched && !showMatched) return null;
              return <div key={row.index} style={{ padding: 12, border: '1px solid #e5e9e5', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ color: result.matched ? '#27805b' : result.possible ? '#a16207' : '#c34444' }}>{result.matched ? '일치' : ignored.includes(row.index) ? '검토 제외' : result.possible ? '부분 일치' : '누락 후보'}</strong>
                  <span style={{ fontSize: 12, color: '#64748b' }}>PDF {row.page}페이지</span>
                  {!result.matched && <button type="button" className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setIgnored((previous) => previous.includes(row.index) ? previous.filter((value) => value !== row.index) : [...previous, row.index])}>{ignored.includes(row.index) ? '검토 복원' : '의도적 생략'}</button>}
                </div>
                <p style={{ margin: '8px 0 0', overflowWrap: 'anywhere' }}>{row.text}</p>
              </div>;
            })}
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 14 }}>현재는 누락 후보를 검토하는 기능입니다. EPUB 원문 수정은 기존 메타데이터 편집 등 해당 수정 기능에서 진행해 주세요. 분류·검토 제외 설정은 페이지 새로고침 시 초기화됩니다.</p>
        </div>
      )}
    </section>
  );
}
