'use client';

import { useEffect, useState } from 'react';
import JSZip from 'jszip';

type PdfTextItem = { str: string; transform: number[] };
type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }>; getViewport: (options: { scale: number }) => { width: number } };
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (input: { data: Uint8Array }) => { promise: Promise<PdfDocument> } };

type CoverSection = 'cover' | 'introduce' | 'backcover';
type MatchRow = { text: string; page: number; column: number };
type Target = { file: string; path: string; phrases: { text: string; source: '본문' | 'alt'; altIndex?: number }[] };
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfJsLoading: Promise<PdfJs> | null = null;
const COVER_FILES = /(?:^|\/)(?:cover|introduce|backcover|incover|incover2)\.xhtml$/i;

function compact(value: string): string {
  return value.normalize('NFKC').replace(/[\u200b-\u200d\ufeff\u00ad]/g, '').replace(/\s+/g, '').replace(/[“”"‘’']/g, '').trim();
}

async function loadPdfJs(): Promise<PdfJs> {
  const global = window as Window & { pdfjsLib?: PdfJs };
  if (global.pdfjsLib) return global.pdfjsLib;
  if (!pdfJsLoading) {
    pdfJsLoading = new Promise<PdfJs>((resolve, reject) => {
      const script = document.querySelector<HTMLScriptElement>('script[data-cover-pdfjs]') ?? document.createElement('script');
      const finish = () => {
        const pdfjs = global.pdfjsLib;
        if (!pdfjs) { reject(new Error('PDF 분석 라이브러리를 초기화하지 못했습니다.')); return; }
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(pdfjs);
      };
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => reject(new Error('PDF 분석 라이브러리를 불러오지 못했습니다.')), { once: true });
      if (!script.parentNode) {
        script.src = PDFJS_URL;
        script.async = true;
        script.dataset.coverPdfjs = 'true';
        document.head.appendChild(script);
      }
    }).catch((error) => { pdfJsLoading = null; throw error; });
  }
  return pdfJsLoading;
}

export async function extractCoverPdf(file: File): Promise<MatchRow[]> {
  const pdfjs = await loadPdfJs();
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: MatchRow[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const width = page.getViewport({ scale: 1 }).width;
      const items = content.items.filter((item) => item.str?.trim()).map((item) => ({
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        text: item.str.trim(),
      }));
      const hasLeft = items.some((item) => item.x < width * 0.4);
      const hasRight = items.some((item) => item.x > width * 0.6);
      const splitColumns = hasLeft && hasRight;
      for (const column of splitColumns ? [0, 1] : [0]) {
        const columnItems = items.filter((item) => !splitColumns || (column === 0 ? item.x < width / 2 : item.x >= width / 2));
        const groups: { y: number; items: { x: number; text: string }[] }[] = [];
        for (const item of columnItems) {
          let group = groups.find((candidate) => Math.abs(candidate.y - item.y) < 2);
          if (!group) { group = { y: item.y, items: [] }; groups.push(group); }
          group.items.push(item);
        }
        for (const group of groups.sort((left, right) => right.y - left.y)) {
          const line = group.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
          if (compact(line)) lines.push({ page: pageNumber, column, text: line });
        }
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
      for (const [altIndex, img] of Array.from(body.querySelectorAll('img[alt]')).entries()) {
        const text = img.getAttribute('alt')?.trim() ?? '';
        if (compact(text) && !/^(앞표지|뒤표지|표지|커버)$/u.test(compact(text))) phrases.push({ text, source: 'alt', altIndex });
      }
    }
    targets.push({ file: path.split('/').pop() ?? path, path, phrases });
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

function compareCompact(value: string): string {
  return compact(value).replace(/[\\\u00b7|｜.,!?;:(){}\[\]『』「」‘’“”"'~\-–—]/g, '');
}

const STANDARD_NOTICE = '국립장애인도서관은 발달장애인과 느린 학습자를 비롯한 모든 이용자가 책을 이해하고 친밀감을 가질 수 있도록 ‘읽기쉬운책’을 제작하고 있습니다. 발달장애인 당사자와 전문가의 의견을 반영하여 160종의 도서를 선정하고, 쉬운 문장 표현과 이미지 활용을 통해 내용을 새롭게 구성하였습니다.';

function evaluate(lines: MatchRow[], target?: Target) {
  const regions = [...new Set(lines.map((line) => line.page + ':' + line.column))].map((key) => {
    const regionLines = lines.filter((line) => line.page + ':' + line.column === key);
    return { lines: regionLines, normalized: compareCompact(regionLines.map((line) => line.text).join('')) };
  });
  return (target?.phrases ?? []).map((phrase, phraseIndex) => {
    const tokens = words(phrase.text).map(compareCompact).filter(Boolean);
    const missing = [...new Set(tokens.filter((token) => !regions.some((region) => region.normalized.includes(token))))];
    const candidates = regions.flatMap((region) => region.lines.map((line, index) => {
      const context = region.lines.slice(Math.max(0, index - 1), index + 4).map((item) => item.text).join('\n');
      const normalized = compareCompact(context);
      const score = tokens.filter((token) => normalized.includes(token)).length;
      return { page: line.page, text: context, score };
    })).sort((left, right) => right.score - left.score);
    const candidate = candidates[0];
    return { ...phrase, phraseIndex, matched: missing.length === 0, missing, candidate: candidate?.score ? candidate : null };
  });
}

function highlight(text: string, tokens: string[]) {
  if (!tokens.length) return text;
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    const positions = tokens.map((token) => ({ token, index: rest.indexOf(token) })).filter((part) => part.index >= 0).sort((a, b) => a.index - b.index);
    if (!positions.length) { parts.push(rest); break; }
    const first = positions[0];
    if (first.index) parts.push(rest.slice(0, first.index));
    parts.push(<mark key={key++}>{first.token}</mark>);
    rest = rest.slice(first.index + first.token.length);
  }
  return parts;
}

export default function EpubCoverPdfCheck({ epubFile, section, coverPdf, onApplyEpub }: { epubFile: File; section?: CoverSection; coverPdf?: File | null; onApplyEpub?: (file: File) => void }) {
  const [pdfFile, setPdfFile] = useState<File | null>(coverPdf ?? null);
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
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

  async function saveCorrection(phraseIndex: number) {
    if (!target || !onApplyEpub) return;
    setSaving(true);
    try {
      const zip = await JSZip.loadAsync(epubFile);
      const entry = zip.file(target.path);
      if (!entry) throw new Error('수정할 XHTML 파일이 없습니다.');
      const xml = await entry.async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xhtml+xml');
      const phrase = target.phrases[phraseIndex];
      const body = doc.querySelector('body');
      if (!body || !phrase) throw new Error('수정할 EPUB 문구가 없습니다.');
      if (phrase.source === 'alt') {
        const img = Array.from(body.querySelectorAll('img[alt]'))[phrase.altIndex ?? -1];
        if (!img) throw new Error('수정할 alt 항목이 없습니다.');
        img.setAttribute('alt', draft);
      } else {
        const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        let found = false;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest('script,style,svg')) continue;
          if (node.textContent?.replace(/\s+/g, ' ').trim() === phrase.text) {
            node.textContent = draft;
            found = true;
            break;
          }
        }
        if (!found) throw new Error('원문 위치를 찾지 못했습니다.');
      }
      zip.file(target.path, new XMLSerializer().serializeToString(doc));
      const blob = await zip.generateAsync({ type: 'blob' });
      onApplyEpub(new File([blob], epubFile.name, { type: 'application/epub+zip', lastModified: Date.now() }));
      setEditing(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'EPUB 수정에 실패했습니다.');
    } finally { setSaving(false); }
  }

  const currentFile = sections.find((item) => item.id === selectedSection)?.file;
  const target = targets.find((item) => item.file.toLowerCase() === currentFile);
  // 공통 안내문은 PDF에서 검색하지 않고 introduce.xhtml의 EPUB 원문에서만 확인합니다.
  const noticeNormalized = compareCompact(STANDARD_NOTICE);
  const epubNoticeText = (target?.phrases ?? []).map((phrase) => phrase.text).join(' ');
  const noticePresent = compareCompact(epubNoticeText).includes(noticeNormalized);
  const noticeFragments = ['국립장애인도서관', '발달장애인과 느린 학습자', '읽기쉬운책', '160종의 도서', '이미지 활용'];
  const isNoticePhrase = (text: string) => noticeFragments.some((fragment) => compareCompact(text).includes(compareCompact(fragment))) || (compareCompact(text).length > 35 && noticeNormalized.includes(compareCompact(text)));
  const results = evaluate(rows ?? [], target).filter((row) => selectedSection !== 'introduce' || !isNoticePhrase(row.text));
  const noticeMissing = selectedSection === 'introduce' && Boolean(target) && !noticePresent;
  const allMatched = Boolean(rows && target && results.every((row) => row.matched) && !noticeMissing);
  const failures = results.filter((row) => !row.matched);

  return (
    <section className="epub-cover-pdf-check">
      <div className="cover-section-tabs" role="group" aria-label="표지 검사 영역">
        {sections.map((item) => <button key={item.id} type="button" className={selectedSection === item.id ? 'is-active' : ''} aria-pressed={selectedSection === item.id} onClick={() => { setSelectedSection(item.id); setEditing(null); }}>{item.label}</button>)}
      </div>
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
            <span>{allMatched ? 'EPUB 문구 모두 확인' : target ? `누락 문구 ${failures.length + (noticeMissing ? 1 : 0)}건` : 'XHTML 파일 없음'}</span>
          </div>
          {noticeMissing && <div className="cover-compare-issue">
            <div className="cover-compare-head"><strong className="status-failure">X</strong><strong>뒷날개 누락</strong></div>
            <div className="cover-compare-grid">
              <div className="cover-compare-side"><strong>EPUB · introduce.xhtml</strong><p>공통 안내문이 없거나 기준 문장과 다릅니다.</p></div>
              <div className="cover-compare-side"><strong>뒷날개 필수 문구</strong><p>{STANDARD_NOTICE}</p><small>PDF는 확인하지 않습니다. EPUB에 이 문장이 있는지만 검사합니다.</small></div>
            </div>
          </div>}
          {!allMatched && failures.map((row) => (
            <div className="cover-compare-issue" key={row.phraseIndex}>
              <div className="cover-compare-head"><strong className="status-failure">X</strong><span>미확인: {row.missing.join(' · ')}</span></div>
              <div className="cover-compare-grid">
                <div className="cover-compare-side">
                  <strong>EPUB · {row.source}</strong>
                  {editing === row.phraseIndex ? (
                    <>
                      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} aria-label="EPUB 원문 수정" />
                      <div className="cover-compare-controls">
                        <button type="button" disabled={saving} onClick={() => void saveCorrection(row.phraseIndex)}>{saving ? '저장 중...' : 'EPUB에 저장'}</button>
                        <button type="button" onClick={() => setEditing(null)}>취소</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>{highlight(row.text, row.missing)}</p>
                      {onApplyEpub && <button type="button" onClick={() => { setEditing(row.phraseIndex); setDraft(row.text); }}>원문 수정</button>}
                    </>
                  )}
                </div>
                <div className="cover-compare-side">
                  <strong>{`PDF ${row.candidate ? `· ${row.candidate.page}페이지` : ''}`}</strong>
                  <p>{row.candidate ? highlight(row.candidate.text, words(row.candidate.text).filter((token) => row.missing.some((missing) => editDistance(token, missing) <= 2))) : '대응하는 PDF 문구를 찾지 못했습니다.'}</p>
                  <small>{'가장 관련성이 높은 PDF 행 · 검토용 후보'}</small>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
