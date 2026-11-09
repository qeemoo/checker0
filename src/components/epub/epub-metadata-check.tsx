'use client';

import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { BOOK_REFERENCES } from '../../lib/epub/book-references';
import { displayEpubPath } from '../../lib/epub/epub-utils';
import type { CountCheckResult, EpubMetadataChecks, MetadataTextDetail } from '../../types/epub';
import { CheckStatus } from './epub-check-ui';

type DetailStatus = { label: string; matched: boolean; status?: 'match' | 'mismatch' | 'suspect' };
type DisplayDetail = { detail: MetadataTextDetail; statuses: DetailStatus[]; highlightTerms: string[]; suspectTerms: string[] };

interface Props {
  checks: EpubMetadataChecks;
  accessibilityModified: boolean;
  metadataTitle: string;
  metadataCreator: string;
  epubFile: File;
  disabled: boolean;
  onFixAccessibility: () => Promise<void>;
  onRemoveAccFix: () => Promise<void>;
  onFixText: (detail: MetadataTextDetail, replacementText: string) => Promise<void>;
  onFixAllTitles: () => Promise<void>;
  onFixAllText: (details: MetadataTextDetail[], replacementText: string) => Promise<void>;
}

function isMetadataTextPassed(value: CountCheckResult) {
  const details = value.details ?? [];
  return details.length > 0 ? details.every((detail) => detail.matched) : value.exists;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedCode({ preview, terms, suspect, suspectTerms }: { preview: string; terms: string[]; suspect?: boolean; suspectTerms?: string[] }) {
  const uniqueTerms = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  const suspectCandidates = [...new Set((suspectTerms?.length ? suspectTerms : uniqueTerms).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (suspect && suspectCandidates.length) {
    const compact = (value: string) => value.replace(/\s+/g, '');
    const normalized = compact(preview);
    const term = suspectCandidates.map(compact).find((candidate) => candidate && normalized.includes(candidate));
    if (term) {
      const positions: number[] = [];
      for (let i = 0; i < preview.length; i += 1) if (!/\s/.test(preview[i])) positions.push(i);
      const startIndex = normalized.indexOf(term);
      const originalStart = positions[startIndex];
      const originalEnd = positions[startIndex + term.length - 1] + 1;
      return <>{preview.slice(0, originalStart)}<mark className="metadata-code-suspect">{preview.slice(originalStart, originalEnd)}</mark>{preview.slice(originalEnd)}</>;
    }
  }
  if (!uniqueTerms.length) return <>{preview}</>;
  const expression = new RegExp(`(${uniqueTerms.map(escapeRegExp).join('|')})`, 'gi');
  const pieces = preview.split(expression);
  return <>{pieces.map((piece, index) => uniqueTerms.some((term) => term.toLowerCase() === piece.toLowerCase())
    ? <mark className="metadata-code-highlight" key={index}>{piece}</mark>
    : <span key={index}>{piece}</span>)}</>;
}

function DetailStatusPill({ status }: { status: DetailStatus }) {
  return (
    <span className={`metadata-detail-status ${status.status === 'suspect' ? 'is-suspect' : status.matched ? 'is-match' : 'is-mismatch'}`}>
      <span aria-hidden="true">{status.matched ? '✓' : '!'}</span>
      {status.label} {status.status === 'suspect' ? '확인 필요' : status.matched ? '일치' : '불일치'}
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
  const cleanPreview = detail.preview.replace(/\s+xmlns(?::[\w.-]+)?=(['"])[\s\S]*?\1/g, '');
  const key = `${detail.file}:${detail.targetType}:${detail.targetIndex}:${detail.partIndex ?? ''}`;

  useEffect(() => setValue(detail.currentText), [detail.currentText]);

  return (
    <article className="metadata-check-detail" key={key}>
      <div className="metadata-detail-heading">
        <strong className="metadata-check-file">{displayEpubPath(detail.file)}</strong>
        <div className="metadata-detail-statuses">
          {statuses.map((status) => <DetailStatusPill key={status.label} status={detail.targetType === 'copyright-symbol-text' ? { ...status, label: '저작권 표기' } : status} />)}
        </div>
      </div>
      <pre className="metadata-check-code"><code><HighlightedCode preview={cleanPreview} terms={item.highlightTerms} suspect={statuses.some((status) => status.status === 'suspect')} suspectTerms={item.suspectTerms} /></code></pre>
      {detail.targetType === 'copyright-symbol-text' && /[Ⓒⓒ]/u.test(detail.preview) && <p className="metadata-check-help">원형 C 기호는 결과 EPUB에서 © 기호로 자동 수정됩니다.</p>}
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
      const key = `${detail.file}:${detail.targetType}:${detail.targetIndex}:${detail.partIndex ?? ''}`;
      const current = merged.get(key);
      if (current) {
        current.statuses.push({ label, matched: detail.matched, status: detail.status });
        if (detail.status === 'suspect') current.suspectTerms.push(label === '제목' ? titleText : creatorText);
      } else merged.set(key, { detail, statuses: [{ label, matched: detail.matched, status: detail.status }], highlightTerms: [titleText, creatorText], suspectTerms: detail.status === 'suspect' ? [label === '제목' ? titleText : creatorText] : [] });
    }
  }
  return [...merged.values()];
}

function resultDetails(label: string, value: CountCheckResult, expectedText: string): DisplayDetail[] {
  return (value.details ?? []).map((detail) => ({ detail, statuses: [{ label, matched: detail.matched, status: detail.status }], highlightTerms: [expectedText], suspectTerms: detail.status === 'suspect' ? [expectedText] : [] }));
}

function MetadataSubsection({
  label,
  items,
  emptyText,
  disabled,
  onFix,
  onApplyAll,
}: {
  label: string;
  items: DisplayDetail[];
  emptyText: string;
  disabled: boolean;
  onFix: (detail: MetadataTextDetail, replacement: string) => Promise<void>;
  onApplyAll?: () => Promise<void>;
}) {
  return (
    <section className="metadata-text-subsection">
      <div className="metadata-text-subsection-heading">
        <h4>{label}</h4>
        {onApplyAll && <button type="button" className="metadata-check-fix-button metadata-apply-metadata-button" disabled={disabled || items.length === 0} onClick={() => void onApplyAll()}>메타데이터 값 적용</button>}
      </div>
      {items.length ? items.map((item) => (
        <MetadataDetailCard key={`${item.detail.file}:${item.detail.targetType}:${item.detail.targetIndex}:${item.detail.partIndex ?? ''}`} item={item} disabled={disabled} onFix={onFix} />
      )) : <p className="metadata-check-empty">{emptyText}</p>}
    </section>
  );
}

export default function EpubMetadataCheck({
  checks,
  accessibilityModified,
  metadataTitle,
  metadataCreator,
  epubFile,
  disabled,
  onFixAccessibility,
  onRemoveAccFix,
  onFixText,
  onFixAllTitles,
  onFixAllText,
}: Props) {
  const [expanded, setExpanded] = useState<'accessibility' | 'accfix' | 'title' | 'cover' | 'copyright' | 'introduce' | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rightsChecks, setRightsChecks] = useState<{ label: string; expected: string; actual: string; ok: boolean }[] | null>(null);
  const [rightsError, setRightsError] = useState('');
  const norm = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').trim();
  const reference = BOOK_REFERENCES.find((book) => norm(book.title) === norm(metadataTitle));
  useEffect(() => {
    let active = true;
    async function inspect() {
      try {
        const zip = await JSZip.loadAsync(epubFile);
        const read = async (name: string) => {
          const path = Object.keys(zip.files).find((item) => item.toLowerCase().endsWith('/' + name) || item.toLowerCase() === name);
          const entry = path ? zip.file(path) : null;
          if (!entry) return null;
          const xml = await entry.async('string');
          const doc = new DOMParser().parseFromString(xml, 'application/xhtml+xml');
          return doc.querySelector('parsererror') ? null : doc;
        };
        const [intro, copyright] = await Promise.all([read('introduce.xhtml'), read('copyright.xhtml')]);
        const authorName = intro?.querySelector('p.author-name')?.textContent?.trim() ?? '';
        const copyrightAuthor = Array.from(copyright?.querySelectorAll('p') ?? []).find((p) => norm(p.querySelector('span.copy_b')?.textContent ?? '') === '지은이');
        const creditedAuthor = copyrightAuthor?.querySelector('span.copy_t')?.textContent?.trim() ?? '';
        const permission = Array.from(copyright?.querySelectorAll('p') ?? []).find((p) => /동의를 받아 만들었습니다/.test(p.textContent ?? ''));
        const permissionText = permission?.textContent?.trim() ?? '';
        const expectedAuthor = metadataCreator.trim();
        const publisher = reference?.publisher ?? '';
        const checks = [
          { label: '소개 · author-name', expected: expectedAuthor, actual: authorName, ok: Boolean(expectedAuthor && norm(authorName) === norm(expectedAuthor)) },
          { label: '판권 · 지은이 / copy_t', expected: expectedAuthor, actual: creditedAuthor, ok: Boolean(expectedAuthor && norm(creditedAuthor) === norm(expectedAuthor)) },
          { label: '판권 · 글 © 작가명', expected: '글 ©' + expectedAuthor, actual: permissionText, ok: Boolean(expectedAuthor && norm(permissionText).includes(norm('글 ©' + expectedAuthor))) },
          { label: '판권 · 도서출판 출판사명', expected: publisher ? '도서출판 ' + publisher : '도서 정보에 출판사 없음', actual: permissionText, ok: Boolean(publisher && norm(permissionText).includes(norm('도서출판' + publisher))) },
        ];
        if (active) { setRightsChecks(checks); setRightsError(''); }
      } catch (error) {
        if (active) { setRightsChecks(null); setRightsError(error instanceof Error ? error.message : '판권 검사 실패'); }
      }
    }
    void inspect();
    return () => { active = false; };
  }, [epubFile, metadataTitle, metadataCreator]);


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
              {checks.accFixTags.length ? checks.accFixTags.map((tag, index) => <pre className="metadata-check-code" key={index}>{tag.replace(/\s+xmlns(?::[\w.-]+)?=(['"])[\s\S]*?\1/g, '')}</pre>) : <p className="metadata-check-help">삭제 대상 태그가 없습니다.</p>}
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
            <MetadataSubsection label="표지 이미지 alt" items={coverItems} emptyText="표지 이미지가 없습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} />
          </div>}
        </div>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'copyright' ? 'is-open' : ''}`} onClick={() => toggle('copyright')} aria-expanded={expanded === 'copyright'}>
            <span className="metadata-check-bullet" /><span className="metadata-check-label">저작권</span><CheckStatus ok={copyrightOk} />
          </button>
          {expanded === 'copyright' && <div className="metadata-check-detail-list">
            <MetadataSubsection label="제목 · copy_title" items={resultDetails('제목', checks.copyrightTitle, metadataTitle)} emptyText="copy_title 클래스를 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} onApplyAll={() => runAction(() => onFixAllText((checks.copyrightTitle.details ?? []), metadataTitle), '메타데이터 제목을 적용했습니다.')} />
            <MetadataSubsection label="저자 · 지은이 / 저작권 표기" items={resultDetails('저자', checks.copyrightCreator, metadataCreator)} emptyText="지은이 또는 저작권 표기가 포함된 항목을 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} onApplyAll={() => runAction(() => onFixAllText((checks.copyrightCreator.details ?? []).filter((detail) => detail.targetType === 'copy-author' || detail.targetType === 'copyright-symbol-text'), metadataCreator), '메타데이터 작가명을 적용했습니다.')} />
          </div>}
        </div>
        <div className="metadata-check-item">
          <button type="button" className={`metadata-check-trigger ${expanded === 'introduce' ? 'is-open' : ''}`} onClick={() => toggle('introduce')} aria-expanded={expanded === 'introduce'}>
            <span className="metadata-check-bullet" /><span className="metadata-check-label">소개</span><CheckStatus ok={introduceOk} />
          </button>
          {expanded === 'introduce' && <div className="metadata-check-detail-list">
            <MetadataSubsection label="저자 · author-name" items={resultDetails('저자', checks.introduceCreator, metadataCreator)} emptyText="author-name 클래스를 가진 p 태그를 찾지 못했습니다." disabled={disabled || busy} onFix={(detail, text) => runAction(() => onFixText(detail, text), '적용되었습니다.')} onApplyAll={() => runAction(() => onFixAllText((checks.introduceCreator.details ?? []), metadataCreator), '메타데이터 작가명을 적용했습니다.')} />
          </div>}
        </div>
      </div>

      <div className="metadata-check-group">
        <h3 className="metadata-check-group-title">작가 · 출판사 교차 검사</h3>
        <p className="metadata-check-help">소개와 판권의 작가명, 판권의 출판사명을 도서 기본 정보 및 등록 도서 목록과 대조합니다.</p>
        {rightsError && <p className="status-failure">{rightsError}</p>}
        {!rightsChecks && !rightsError && <p className="metadata-check-help">검사 중...</p>}
        {rightsChecks?.map((item) => (
          <div className="metadata-check-item" key={item.label}>
            <div className="rights-check-row">
              <div><strong>{item.label}</strong><p>기준: {item.expected}</p>{!item.ok && <p>EPUB: {item.actual || '(해당 항목 없음)'}</p>}</div>
              <CheckStatus ok={item.ok} />
            </div>
          </div>
        ))}
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
                <strong className="metadata-title-file">{displayEpubPath(detail.file)}</strong>
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
