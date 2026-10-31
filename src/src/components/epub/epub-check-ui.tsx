'use client';
import { useState } from 'react';
import type { CountCheckResult, FileCheckResult, LoiCheckResult, TitleCheckResult } from '../../types/epub';

export function CheckStatus({ ok, modified = false }: { ok: boolean; modified?: boolean }) {
  return <span className={`check-status ${ok ? 'is-success' : 'is-failure'}`}>{ok ? '통과' : '실패'}{modified ? ' · 수정됨' : ''}</span>;
}

export function CountCheckRow({ label, value, modified = false }: { label: string; value: CountCheckResult; modified?: boolean }) {
  return <div className="check-static-row"><span>{label}</span><CheckStatus ok={value.exists} modified={modified} /></div>;
}

export function FileCheckRow({ label, value }: { label: string; value: FileCheckResult | TitleCheckResult }) {
  const [open, setOpen] = useState(false);
  const ok = value.unmatched === 0;
  return <div className={`check-item ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={`check-triangle ${open ? 'is-active' : ''}`} aria-hidden="true" />
      <span className="check-item-label">{label}</span>
      <CheckStatus ok={ok} />
    </button>
    {open && <div className="check-detail-box">
      {ok ? <p className="check-detail-success">모든 항목이 정상입니다.</p> : <>
        {value.unmatchedFiles.map((file) => <p className="structure-failure-line" key={file}>{file}</p>)}
        {'unmatchedDetails' in value && value.unmatchedDetails?.map((detail, index) => <div key={`${detail.file}-${detail.sectionIndex}-${index}`} className="structure-failure"><strong>{detail.file} · section {detail.sectionIndex}</strong><ul>{detail.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><pre>{detail.html}</pre></div>)}
      </>}
    </div>}
  </div>;
}

export function LoiCheckRow({ label, value }: { label: string; value: LoiCheckResult }) {
  const [open, setOpen] = useState(false);
  const ok = value.unmatched === 0;
  return <div className={`check-item ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={`check-triangle ${open ? 'is-active' : ''}`} aria-hidden="true" />
      <span className="check-item-label">{label}</span>
      <CheckStatus ok={ok} />
    </button>
    {open && <div className="check-detail-box">{ok ? <p className="check-detail-success">모든 항목이 정상입니다.</p> : value.details.map((item, index) => <pre className="loi-detail-code" key={`${index}-${item}`}>{item}</pre>)}</div>}
  </div>;
}
