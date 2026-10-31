'use client';

import { useEffect, useState } from 'react';
import type { CountCheckResult, EpubMetadataChecks, MetadataTextDetail } from '../../types/epub';
import { CheckStatus } from './epub-check-ui';

type DetailStatus = { label: string; matched: boolean };
type DisplayDetail = { detail: MetadataTextDetail; statuses: DetailStatus[]; highlightTerms: string[] };

interface Props {
  checks: EpubMetadataChecks;
  accessibilityModified: boolean;
  metadataTitle: string;
  metadataCreator: string;
  disabled: boolean;
  onFixAccessibility: () => Promise<void>;
  onRemoveAccFix: () => Promise<void>;
  onFixText: (detail: MetadataTextDetail, replacementText: string) => Promise<void>;
  onFixAllTitles: () => Promise<void>;
}

function isMetadataTextPassed(value: CountCheckResult) {
  const details = value.details ?? [];
  return details.length > 0 ? details.every((detail) => detail.matched) : value.exists;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedCode({ preview, terms }: { preview: string; terms: string[] }) {
  const uniqueTerms = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!uniqueTerms.length) return <>{preview}</>;

  const expression = new RegExp(`(${uniqueTerms.map(escapeRegExp).join('|')})`, 'gi');
  const pieces = preview.split(expression);
  return <>{pieces.map((piece, index) => uniqueTerms.some((term) => term.toLowerCase() === piece.toLowerCase())
    ? <mark className="metadata-code-highlight" key={index}>{piece}</mark>
    : <span key={index}>{piece}</span>)}</>;
}

function DetailStatusPill({ status }: { status: DetailStatus }) {
  return (
    <span className={`metadata-detail-status ${status.matched ? 'is-match' : 'is-mismatch'}`}>
      <span aria-hidden="true">{status.matched ? '✓' : '!'}</span>
      {status.label} {status.matched ? '일치' : '불일치'}
    </span>
  );
}

function MetadataDetailCard({
  item,
  disabled,
  onFix,
}: {
  item: DisplayDetail;
  disabled: boolean;
  onFix: (detail: MetadataTextDetail, replacement: string) => Promise<void>;
}) {
  const { detail, statuses } = item;
  const [value, setValue] = useState(detail.currentText);
  const cleanPreview = detail.preview.replace(/\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
  const key = `${detail.file}:${detail.targetType}:${detail.targetIndex}`;

  useEffect(() => setValue(detail.currentText), [detail.currentText]);

  return (
    <article className="metadata-check-detail" key={key}>
      <div className="metadata-detail-heading">
        <strong className="metadata-check-file">{detail.file}</strong>
        <div className="metadata-detail-statuses">
          {statuses.map((status) => <DetailStatusPill key={status.label} status={status} />)}
        </div>
      </div>
      <pre className="metadata-check-code"><code><HighlightedCode preview={cleanPreview} terms={item.highlightTerms} /></code></pre>
      <label className="metadata-check-edit-label">
        수정할 내용
        <textarea
          rows={2}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
      </label>
      <div className="metadata-check-detail-actions">
        
        <button
          type="button"
          className="metadata-check-fix-button"
          disabled={disabled || !value.trim() || value === detail.currentText}
          onClick={() => void onFix(detail, value)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 8 14l8-8" /></svg>
          저장
        </button>
      </div>
    </article>
  );
}

function mergeCoverDetails(title: CountCheckResult, creator: CountCheckResult, titleText: string, creatorText: string): DisplayDetail[] {
  const merged = new Map<string, DisplayDetail>();
  for (const [label, result] of [['제목', title], ['저자', creator]] as const) {
    for (const detail of result.details ?? []) {
      const key = `${detail.file}:${detail.targetType}:${detail.targetIndex}`;
      const current = merged.get(key);
      if (current) current.statuses.push({ label, matched: detail.matched });
      else merged.set(key, { detail, statuses: [{ label, matched: detail.matched }], highlightTerms: [titleText, creatorText] });
    }
  }
  return [...merged.values()];
}

function resultDetails(label: string, value: CountCheckResult, expectedText: string): DisplayDetail[] {
  return (value.details ?? []).map((detail) => ({ detail, statuses: [{ label, matched: detail.matched }], highlightTerms: [expectedText] }));
}

function MetadataSubsection({
  label,
  items,
  emptyText,
  disabled,
  onFix,
}: {
  label: string;
  items: DisplayDetail[];
  emptyText: string;
  disabled: boolean;
  onFix: (detail: MetadataTextDetail, replacement: string) => Promise<void>;
}) {
  return (
    <section className="metadata-text-subsection">
      <div className="metadata-text-subsection-heading">
        <h4>{label}</h4>
      </div>
      {items.length ? items.map((item) => (
        <MetadataDetailCard key={`${item.detail.file}:${item.detail.targetType}:${item.detail.targetIndex}`} item={item} disabled={disabled} onFix={onFix} />
      )) : <p className="metadata-check-empty">{emptyText}</p>}
    </section>
  );
}

export default function EpubMetadataCheck({
  checks,
  accessibilityModified,
  metadataTitle,
  metadataCreator,
  disabled,
  onFixAccessibility,
  onRemoveAccFix,
  onFixText,
  onFixAllTitles,
}: Props) {
  const [expanded, setExpanded] = useState<'accessibility' | 'accfix' | 'title' | 'cover' | 'copyright' | 'introduce' | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2300);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      setToast({ ok: true, message: success });
    } catch {
      setToast({ ok: false, message: '실패했습니다.' });
    } finally {
      setBusy(false);
    }
  }

  const conformValue = checks.conformsToValue ?? 'dcterms:conformsTo 태그 없음';
  const titleOk = checks.titleXhtml.unmatched === 0;
  const coverOk = isMetadataTextPassed(checks.coverTitle) && isMetadataTextPassed(checks.coverCreator);
  const copyrightOk = isMetadataTextPassed(checks.copyrightTitle) && isMetadataTextPassed(checks.copyrightCreator);
  const introduceOk = isMetadataTextPassed(checks.introduceCreator);
  const coverItems = mergeCoverDetails(checks.coverTitle, checks.coverCreator, metadataTitle, metadataCreator);

  function toggle(key: NonNullable<typeof expanded>) {
    setExpanded((current) => current === key ? null : key);
  }

  return (
    <section className="panel metadata-check-panel">
      <h2 className="mb-5 text-xl font-bold">메타데이터 검사</h2>

      <div className="metadata-check-group">
        <h3 className="metadata-check-group-title">접근성 적합성</h3>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'accessibility' ? 'is-open' : ''}`} onClick={() => toggle('accessibility')} aria-expanded={expanded === 'accessibility'}>
            <span className="metadata-check-bullet" />
            <span className="metadata-check-label">WCAG 2.2 AA 적합성</span>
            <CheckStatus ok={checks.conformsTo} modified={accessibilityModified} />
          </button>
          {expanded === 'accessibility' && (
            <div className="metadata-check-inline-detail">
              <div className="metadata-check-code-line"><code>{checks.conformsTo && conformValue.includes('Level AA') ? <>{conformValue.split('Level AA')[0]}Level <mark className="metadata-aa-highlight">AA</mark></> : conformValue}</code></div>
              {!checks.conformsTo && (conformValue.includes('AAA') || /Level A\b/.test(conformValue)) && (
                <div className="metadata-check-convert-row">
                  <span><code>{conformValue}</code><span className="metadata-arrow">→</span><strong>{conformValue.replace(/AAA|Level A\b/, 'AA')}</strong></span>
                  <button type="button" className="metadata-check-fix-button" disabled={disabled || busy} onClick={() => void runAction(onFixAccessibility, '적용되었습니다.')}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 8 14l8-8" /></svg>수정
                  </button>
                </div>
              )}
              {!checks.conformsTo && !/AAA|Level A\b/.test(conformValue) && <p className="metadata-check-help">현재 메타데이터 값을 확인해 주세요.</p>}
            </div>
          )}
        </div>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'accfix' ? 'is-open' : ''}`} onClick={() => { if (!checks.accFix) toggle('accfix'); }} aria-expanded={expanded === 'accfix'} disabled={checks.accFix}>
            <span className="metadata-check-bullet" />
            <span className="metadata-check-label">ACC-fix 메타데이터 미포함</span>
            <CheckStatus ok={checks.accFix} />
          </button>
          {expanded === 'accfix' && (
            <div className="metadata-check-inline-detail">
              {checks.accFixTags.length ? checks.accFixTags.map((tag, index) => <pre className="metadata-check-code" key={index}>{tag.replace(/\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')}</pre>) : <p className="metadata-check-help">삭제 대상 태그가 없습니다.</p>}
              {!checks.accFix && <div className="metadata-check-convert-row"><span>ACC-fix 메타데이터 태그</span><button type="button" className="metadata-check-fix-button" disabled={disabled || busy} onClick={() => void runAction(onRemoveAccFix, '적용되었습니다.')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m-6 0 1 10h6l1-10" /></svg>삭제</button></div>}
            </div>
          )}
        </div>
      </div>

      <div className="metadata-check-group">
        <h3 className="metadata-check-group-title">제목 · 작가</h3>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'cover' ? 'is-open' : ''}`} onClick={() => toggle('cover')} aria-expanded={expanded === 'cover'}>
            <span className="metadata-check-bullet" /><span className="metadata-check-label">표지</span><CheckStatus ok={coverOk} />
          </button>
          {expanded === 'cover' && <div className="metadata-check-detail-list">
            <MetadataSubsection label="표지" items={coverItems} emptyText="표지 이미지의 alt 정보를 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} />
          </div>}
        </div>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'copyright' ? 'is-open' : ''}`} onClick={() => toggle('copyright')} aria-expanded={expanded === 'copyright'}>
            <span className="metadata-check-bullet" /><span className="metadata-check-label">저작권</span><CheckStatus ok={copyrightOk} />
          </button>
          {expanded === 'copyright' && <div className="metadata-check-detail-list">
            <MetadataSubsection label="제목" items={resultDetails('제목', checks.copyrightTitle, metadataTitle)} emptyText="제목과 일치하는 텍스트를 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} />
            <MetadataSubsection label="저자" items={resultDetails('저자', checks.copyrightCreator, metadataCreator)} emptyText="저자와 일치하는 텍스트를 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} />
          </div>}
        </div>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'introduce' ? 'is-open' : ''}`} onClick={() => toggle('introduce')} aria-expanded={expanded === 'introduce'}>
            <span className="metadata-check-bullet" /><span className="metadata-check-label">소개</span><CheckStatus ok={introduceOk} />
          </button>
          {expanded === 'introduce' && <div className="metadata-check-detail-list">
            <MetadataSubsection label="저자" items={resultDetails('저자', checks.introduceCreator, metadataCreator)} emptyText="저자와 일치하는 텍스트를 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} />
          </div>}
        </div>
      </div>

      <div className="metadata-check-group">
        <h3 className="metadata-check-group-title">title</h3>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'title' ? 'is-open' : ''}`} onClick={() => toggle('title')} aria-expanded={expanded === 'title'}>
            <span className="metadata-check-bullet" /><span className="metadata-check-label">title 일치</span><span className="metadata-check-count">불일치 {checks.titleXhtml.unmatched}건</span><CheckStatus ok={titleOk} />
          </button>
          {expanded === 'title' && <div className="metadata-check-detail-list metadata-title-detail-list">
            <div className="metadata-title-heading-row">
              <div className="metadata-title-book-title"><strong>{metadataTitle}</strong></div>
              <button type="button" className="metadata-check-fix-button" disabled={disabled || busy} onClick={() => void runAction(onFixAllTitles, '모든 title을 수정했습니다.')}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 13.5-.7 3.2 3.2-.7L16 6.5 13.5 4 4 13.5Z" /><path d="m12.5 5 2.5 2.5" /></svg>수정
              </button>
            </div>
            {titleOk ? (
              <p className="metadata-check-empty metadata-title-passed">모든 XHTML title이 메타데이터 제목과 일치합니다.</p>
            ) : checks.titleXhtml.details.filter((detail) => !detail.matched).map((detail) => (
              <div className="metadata-title-detail" key={detail.file}>
                <strong className="metadata-title-file">{detail.file}</strong>
                <span className="metadata-title-current">{detail.title || '(title 없음)'}</span>
              </div>
            ))}
          </div>}
        </div>
      </div>

      {toast && <div className={`metadata-toast ${toast.ok ? 'is-success' : 'is-error'}`} role="status">{toast.ok ? '✅' : '⚠️'} {toast.message}</div>}
    </section>
  );
}
