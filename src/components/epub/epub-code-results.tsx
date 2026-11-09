'use client';

import { useEffect, useState, type ReactNode } from 'react';
import JSZip from 'jszip';
import type { CodeIssueDetail, CodeCheckItemResult, EpubCodeChecks } from '../../types/epub';
import { displayEpubPath } from '../../lib/epub/epub-utils';

interface Props { checks: EpubCodeChecks; onFixIssue: (detail: CodeIssueDetail) => void | Promise<void>; onFixDialogueQuotes: () => void | Promise<void>; fixingKey: string | null; disabled?: boolean; file?: File | null }
function Status({ ok }: { ok: boolean }) { return <span className={`check-status ${ok ? 'is-success' : 'is-failure'}`}>{ok ? '통과' : '실패'}</span>; }
function keyOf(detail: CodeIssueDetail) { return `${detail.file}:${detail.fixType}:${detail.targetIndex}`; }
function preview(source: string) { return source.replace(/\s+xmlns(?::[\w.-]+)?=(['"])[\s\S]*?\1/g, ''); }

type TablePreview = { file: string; index: number; html: string; text: string };

function safeTableMarkup(table: Element) {
  const clone = table.cloneNode(true) as Element;
  clone.querySelectorAll('script, iframe, object, embed, form, input, button, link, meta').forEach((node) => node.remove());
  clone.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      if (/^on/i.test(attribute.name) || /^(href|src|xlink:href)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    });
  });
  return clone.outerHTML;
}

function TableGroup({ file }: { file?: File | null }) {
  const [tables, setTables] = useState<TablePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [codeView, setCodeView] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function readTables() {
      if (!file) { setTables([]); return; }
      setLoading(true);
      try {
        const zip = await JSZip.loadAsync(file);
        const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && /\.(xhtml|html|htm)$/i.test(path));
        const found: TablePreview[] = [];
        for (const path of paths) {
          const source = await zip.file(path)?.async('text');
          if (!source) continue;
          const document = new DOMParser().parseFromString(source, 'text/html');
          Array.from(document.querySelectorAll('table')).forEach((table, index) => {
            const html = safeTableMarkup(table);
            const text = (table.textContent || '').replace(/\s+/g, ' ').trim();
            found.push({ file: path, index: index + 1, html, text });
          });
        }
        if (!cancelled) setTables(found);
      } catch (error) {
        console.error('EPUB 표를 읽지 못했습니다.', error);
        if (!cancelled) setTables([]);
      } finally { if (!cancelled) setLoading(false); }
    }
    void readTables();
    return () => { cancelled = true; };
  }, [file]);

  return <section className={`code-group table-code-group ${expanded ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className={`check-triangle ${expanded ? 'is-active' : ''}`} /><span className="check-item-label">표</span><Status ok={true} />
    </button>
    {expanded && <div className="code-group-content table-code-content">
      {loading ? <p className="check-detail-success">EPUB의 표를 확인하고 있습니다.</p> : tables.length === 0 ? <p className="check-detail-success">table 태그가 포함된 파일이 없습니다.</p> : tables.map((table) => {
        const key = `${table.file}#table-${table.index}`;
        const showCode = Boolean(codeView[key]);
        return <article className="table-preview-card" key={key}>
          <header className="table-preview-header"><div><strong>{displayEpubPath(table.file)}</strong><span>표 {table.index}{table.text ? ` · ${table.text.slice(0, 70)}` : ''}</span></div><button type="button" className="table-code-toggle" onClick={() => setCodeView((current) => ({ ...current, [key]: !current[key] }))}>{showCode ? '표 보기' : '코드 보기'}</button></header>
          {showCode ? <pre className="table-source-code"><code>{table.html}</code></pre> : <div className="table-render-preview" dangerouslySetInnerHTML={{ __html: table.html }} />}
        </article>;
      })}
    </div>}
  </section>;
}

function FixCard({ detail, onFixIssue, fixingKey, disabled }: { detail: CodeIssueDetail; onFixIssue: Props['onFixIssue']; fixingKey: string | null; disabled: boolean }) {
  const [asideRole, setAsideRole] = useState<'none' | 'doc-tip'>(detail.asideRole ?? 'doc-tip');
  const [fixed, setFixed] = useState(false);
  const key = keyOf(detail);
  async function apply() { setFixed(true); try { await onFixIssue({ ...detail, ...(detail.fixType === 'aside' ? { asideRole } : {}) }); } catch { setFixed(false); } }
  return <article className="code-issue-card">
    <div className="code-issue-heading"><div><strong>{displayEpubPath(detail.file)}</strong><span>{detail.element}</span></div>
      {detail.fixType === 'aside' && detail.reasons.length > 0 && <div className="aside-role-actions"><button type="button" className={asideRole === 'none' ? 'is-selected' : ''} onClick={() => setAsideRole('none')} disabled={disabled}>none</button><button type="button" className={asideRole === 'doc-tip' ? 'is-selected' : ''} onClick={() => setAsideRole('doc-tip')} disabled={disabled}>tip</button></div>}
    </div>
    {detail.reasons.length > 0 && <ul className="code-issue-reasons">{detail.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    <pre className="code-issue-preview">{preview(detail.html)}</pre>
    <div className="code-issue-footer"><span className={fixed ? 'code-fixed-message' : ''}>{fixed ? '✓ 수정되었습니다.' : ''}</span><button type="button" className="compact-action" onClick={apply} disabled={disabled || fixingKey === key || fixed || detail.reasons.length === 0}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>{fixingKey === key ? '수정 중' : '수정'}</button></div>
  </article>;
}

function CodeGroup({ label, value, onFixIssue, fixingKey, disabled, showAll = false, children }: { label: string; value: CodeCheckItemResult; onFixIssue: Props['onFixIssue']; fixingKey: string | null; disabled: boolean; showAll?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const visible = showAll ? value.details : value.details.filter((detail) => detail.reasons.length > 0);
  return <section className={`code-group ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={value.unmatched === 0 && visible.length === 0 && !children}><span className={`check-triangle ${open ? 'is-active' : ''}`} /><span className="check-item-label">{label}</span><Status ok={value.unmatched === 0} /></button>
    {open && <div className="code-group-content">{visible.length ? visible.map((detail) => <FixCard key={keyOf(detail)} detail={detail} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />) : !children && <p className="check-detail-success">실패 항목이 없습니다.</p>}{children}</div>}
  </section>;
}


function AsideGroup({ value, onFixIssue, fixingKey, disabled }: { value: CodeCheckItemResult; onFixIssue: Props['onFixIssue']; fixingKey: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  return <section className={`code-group ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={value.details.length === 0}><span className={`check-triangle ${open ? 'is-active' : ''}`} /><span className="check-item-label">글상자</span><Status ok={value.unmatched === 0} /></button>
    {open && <div className="code-group-content">{value.details.length === 0 ? <p className="check-detail-success">글상자가 없습니다.</p> : value.details.map((detail) => {
      const key = keyOf(detail);
      const expanded = selected === key;
      const [tag] = preview(detail.html).match(/<aside\b[^>]*>/i) ?? ['<aside>'];
      return <article className="aside-list-item" key={key}>
        <div className="aside-list-trigger">
          <button type="button" className="aside-list-open" onClick={() => setSelected(expanded ? null : key)}><span><strong>{displayEpubPath(detail.file)}</strong><code>{tag}</code></span></button>
          {detail.reasons.length > 0 && <div className="aside-role-actions"><button type="button" onClick={() => onFixIssue({ ...detail, asideRole: 'none' })} disabled={disabled || fixingKey === key}>none</button><button type="button" onClick={() => onFixIssue({ ...detail, asideRole: 'doc-tip' })} disabled={disabled || fixingKey === key}>tip</button></div>}
          <span className={`check-status ${detail.reasons.length ? 'is-failure' : 'is-success'}`}>{detail.reasons.length ? '실패' : '통과'}</span>
        </div>
        {expanded && <div className="aside-expanded"><pre className="code-issue-preview">{preview(detail.html)}</pre></div>}
      </article>;
    })}</div>}
  </section>;
}

export default function EpubCodeResults({ checks, onFixIssue, onFixDialogueQuotes, fixingKey, disabled = false, imageAssets, file }: Props & { imageAssets?: ReactNode }) {
  return <section className="panel check-page-panel"><h2 className="check-page-title">코드</h2><div className="code-groups">
    <div className="toc-excluded-heading"><strong>대화문 따옴표</strong><button type="button" className="compact-action" onClick={() => void onFixDialogueQuotes()} disabled={disabled || fixingKey !== null || !checks.dialogue.details.some((detail) => detail.reasons.some((reason) => reason.includes("따옴표")))}>여닫는 따옴표 일괄 수정</button></div>
    <CodeGroup label="대화문" value={checks.dialogue} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
    <AsideGroup value={checks.asideRole} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
    <CodeGroup label="이미지" value={checks.imageRole} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled}>{imageAssets}</CodeGroup>
    <CodeGroup label="각주" value={checks.footnote} onFixIssue={onFixIssue} fixingKey={fixingKey} disabled={disabled} />
    <TableGroup file={file} />
  </div></section>;
}
