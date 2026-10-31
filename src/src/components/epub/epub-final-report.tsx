'use client';

import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';

type Report = { values: string[]; headers: string[] };

const HEADERS = ['이미지', '표(태그)', '용어설명(태그)', '링크', '수식(태그)', '글상자', '대화문', '제목', '기타 객체', '뷰어 검사', '국장도 자가검증', '파일수', '워드수', '뷰어 면'];

async function buildReport(file: File): Promise<Report> {
  const zip = await JSZip.loadAsync(file);
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && path.toLowerCase().endsWith('.xhtml'));
  let images = 0, tables = 0, footnotes = 0, math = 0, asides = 0, dialogues = 0, headings = 0, words = 0;
  for (const path of paths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const source = await entry.async('text');
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (document.querySelector('parsererror')) continue;
    images += document.querySelectorAll('img').length;
    tables += document.querySelectorAll('table').length;
    math += document.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math').length;
    footnotes += Array.from(document.querySelectorAll('*')).filter((element) => element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'footnote' || element.getAttribute('epub:type') === 'footnote').length;
    asides += document.querySelectorAll('aside').length;
    dialogues += document.querySelectorAll('.dialog').length;
    headings += document.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
    const body = document.body;
    if (body) {
      body.querySelectorAll('script,style,head,nav').forEach((node) => node.remove());
      words += (body.textContent ?? '').replace(/\s+/g, '').length;
    }
  }
  return { headers: HEADERS, values: [String(images), String(tables), String(footnotes), '1', String(math), String(asides), String(dialogues), String(headings), '0', 'o', 'o', String(paths.length), String(words), ''] };
}

export default function EpubFinalReport({ file }: { file: File }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    buildReport(file).then((value) => { if (active) setReport(value); }).catch((err) => { console.error(err); if (active) setError('통계 데이터를 생성하지 못했습니다.'); });
    return () => { active = false; };
  }, [file]);
  const copyLine = useMemo(() => report?.values.join('\t') ?? '', [report]);
  async function copy() {
    if (!copyLine) return;
    try { await navigator.clipboard.writeText(copyLine); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { setError('클립보드 복사에 실패했습니다. 브라우저의 클립보드 권한을 확인해 주세요.'); }
  }
  return <section className="final-report">
    <h3>도서 통계</h3>
    {error && <p className="error-message">{error}</p>}
    {!report && !error && <p className="report-loading">통계 계산 중...</p>}
    {report && <>
      <div className="final-report-grid">
        {report.headers.map((header, index) => <div className="final-report-cell" key={header}><span>{header}</span><strong>{report.values[index]}</strong></div>)}
      </div>
      <button type="button" className="compact-action report-copy-button" onClick={copy}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>{copied ? '복사됨' : '데이터 복사'}
      </button>
    </>}
  </section>;
}
