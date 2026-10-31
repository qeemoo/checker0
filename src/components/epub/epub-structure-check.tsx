'use client';

import { useState } from 'react';
import type { EpubMetadataChecks, FileCheckResult } from '../../types/epub';

function Status({ ok }: { ok: boolean }) {
  return <span className={`check-status ${ok ? 'is-success' : 'is-failure'}`}>{ok ? '통과' : '실패'}</span>;
}

function StructureItem({ label, value }: { label: string; value: FileCheckResult }) {
  const [open, setOpen] = useState(false);
  const ok = value.unmatched === 0;
  return <div className={`check-item ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={`check-triangle ${open ? 'is-active' : ''}`} aria-hidden="true" />
      <span className="check-item-label">{label}</span>
      <Status ok={ok} />
    </button>
    {open && <div className="check-detail-box">
      {ok ? <p className="check-detail-success">모든 항목이 정상입니다.</p> : value.unmatchedDetails?.length ? value.unmatchedDetails.map((item, index) => <div className="structure-failure" key={`${item.file}-${index}`}><strong>{item.file}</strong><ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><pre>{item.html}</pre></div>) : value.unmatchedFiles.map((file) => <p className="structure-failure-line" key={file}>{file}</p>)}
    </div>}
  </div>;
}

export default function EpubStructureCheck({ checks, disabled, onFixLanguage }: { checks: EpubMetadataChecks; disabled: boolean; onFixLanguage: () => void }) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageOk = checks.language.unmatched === 0;
  const chapter = checks.chapter;
  return <section className="panel check-page-panel">
    <h2 className="check-page-title">구조 및 언어</h2>
    <div className={`check-item ${languageOpen ? 'is-open' : ''}`}>
      <button type="button" className="check-item-trigger" onClick={() => languageOk ? undefined : setLanguageOpen((v) => !v)} aria-expanded={languageOpen} disabled={languageOk}>
        <span className={`check-triangle ${languageOpen ? 'is-active' : ''}`} aria-hidden="true" />
        <span className="check-item-label">언어</span>
        <Status ok={languageOk} />
      </button>
      {languageOpen && !languageOk && <div className="check-detail-box">
        <div className="check-detail-heading"><span>언어 수정</span><button type="button" className="compact-action" onClick={onFixLanguage} disabled={disabled}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>수정</button></div>
        {checks.language.fileValues?.filter((item) => item.lang !== 'ko' || item.xmlLang !== 'ko').map((item) => <div className="language-file-row" key={item.file}><strong>{item.file}</strong><span>lang: {item.lang ?? '없음'} · xml:lang: {item.xmlLang ?? '없음'}</span></div>)}
      </div>}
    </div>
    <StructureItem label="section 속성" value={chapter} />
  </section>;
}
