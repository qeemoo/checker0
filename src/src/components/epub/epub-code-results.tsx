'use client';

import { useState } from 'react';
import type { CodeIssueDetail, CodeCheckItemResult, EpubCodeChecks } from '../../types/epub';

interface Props { checks: EpubCodeChecks; onFixIssue: (detail: CodeIssueDetail) => void | Promise<void>; fixingKey: string | null; disabled?: boolean }
function Status({ ok }: { ok: boolean }) { return <span className={`check-status ${ok ? 'is-success' : 'is-failure'}`}>{ok ? '통과' : '실패'}</span>; }
function keyOf(detail: CodeIssueDetail) { return `${detail.file}:${detail.fixType}:${detail.targetIndex}`; }
function preview(source: string) { return source.replace(/\s+xmlns(?::[\w.-]+)?=(['"])[\s\S]*?\1/g, ''); }

function FixCard({ detail, onFixIssue, fixingKey, disabled }: { detail: CodeIssueDetail; onFixIssue: Props['onFixIssue']; fixingKey: string | null; disabled: boolean }) {
  const [asideRole, setAsideRole] = useState<'none' | 'doc-tip'>(detail.asideRole ?? 'doc-tip');
  const [fixed, setFixed] = useState(false);
  const key = keyOf(detail);
  async function apply() { setFixed(true); try { await onFixIssue({ ...detail, ...(detail.fixType === 'aside' ? { asideRole } : {}) }); } catch { setFixed(false); } }
  return <article className="code-issue-card">
    <div className="code-issue-heading"><div><strong>{detail.file}</strong><span>{detail.element}</span></div>
      {detail.fixType === 'aside' && detail.reasons.length > 0 && <div className="aside-role-actions"><button type="button" className={asideRole === 'none' ? 'is-selected' : ''} onClick={() => setAsideRole('none')} disabled={disabled}>none</button><button type="button" className={asideRole === 'doc-tip' ? 'is-selected' : ''} onClick={() => setAsideRole('doc-tip')} disabled={disabled}>tip</button></div>}
    </div>
    {detail.reasons.length > 0 && <ul className="code-issue-reasons">{detail.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    <pre className="code-issue-preview">{preview(detail.html)}</pre>
    <div className="code-issue-footer"><span className={fixed ? 'code-fixed-message' : ''}>{fixed ? '✓ 수정되었습니다.' : ''}</span><button type="button" className="compact-action" onClick={apply} disabled={disabled || fixingKey === key || fixed || detail.reasons.length === 0}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>{fixingKey === key ? '수정 중' : '수정'}</button></div>
  </article>;
}

function CodeGroup({ label, value, onFixIssue, fixingKey, disabled, showAll = false }: { label: string; value: CodeCheckItemResult; onFixIssue: Props['onFixIssue']; fixingKey: string | null; disabled: boolean; showAll?: boolean }) {
  const [open, setOpen] = useState(false);
  const visible = showAll ? value.details : value.details.filter((detail) => detail.reasons.length > 0);
  return <section className={`code-group ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}><span className={`check-triangle ${open ? 'is-active' : ''}`} /><span className="check-item-label">{label}</span><Status ok={value.unmatched === 0} /></button>
    {open && <div className="code-group-content">{visible.length ? visible.map((detail) => <FixCard key={keyOf(detail)} detail={detail} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />) : <p className="check-detail-success">실패 항목이 없습니다.</p>}</div>}
  </section>;
}


function AsideGroup({ value, onFixIssue, fixingKey, disabled }: { value: CodeCheckItemResult; onFixIssue: Props['onFixIssue']; fixingKey: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  return <section className={`code-group ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}><span className={`check-triangle ${open ? 'is-active' : ''}`} /><span className="check-item-label">글상자</span><Status ok={value.unmatched === 0} /></button>
    {open && <div className="code-group-content">{value.details.length === 0 ? <p className="check-detail-success">글상자가 없습니다.</p> : value.details.map((detail) => {
      const key = keyOf(detail);
      const expanded = selected === key;
      const [tag] = preview(detail.html).match(/<aside\b[^>]*>/i) ?? ['<aside>'];
      return <article className="aside-list-item" key={key}>
        <div className="aside-list-trigger">
          <button type="button" className="aside-list-open" onClick={() => setSelected(expanded ? null : key)}><span><strong>{detail.file}</strong><code>{tag}</code></span></button>
          {detail.reasons.length > 0 && <div className="aside-role-actions"><button type="button" onClick={() => onFixIssue({ ...detail, asideRole: 'none' })} disabled={disabled || fixingKey === key}>none</button><button type="button" onClick={() => onFixIssue({ ...detail, asideRole: 'doc-tip' })} disabled={disabled || fixingKey === key}>tip</button></div>}
          <span className={`check-status ${detail.reasons.length ? 'is-failure' : 'is-success'}`}>{detail.reasons.length ? '실패' : '통과'}</span>
        </div>
        {expanded && <div className="aside-expanded"><pre className="code-issue-preview">{preview(detail.html)}</pre></div>}
      </article>;
    })}</div>}
  </section>;
}

export default function EpubCodeResults({ checks, onFixIssue, fixingKey, disabled = false }: Props) {
  return <section className="panel check-page-panel"><h2 className="check-page-title">코드</h2><div className="code-groups">
    <CodeGroup label="대화문" value={checks.dialogue} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
    <AsideGroup value={checks.asideRole} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
    <CodeGroup label="이미지" value={checks.imageRole} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
    <CodeGroup label="각주" value={checks.footnote} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
  </div></section>;
}
