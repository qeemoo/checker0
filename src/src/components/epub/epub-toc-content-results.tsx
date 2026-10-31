'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TocContentIssue } from '../../types/epub';

interface Props {
  issues: TocContentIssue[];
  error?: string;
  onSave: (edits: { issueId: string; tocText: string; contentText: string }[]) => void;
  disabled: boolean;
  onDraftChange?: (edits: { issueId: string; tocText: string; contentText: string }[], changed: boolean) => void;
}

type Draft = { tocText: string; contentText: string };

export default function EpubTocContentResults({ issues, error, onSave, disabled, onDraftChange }: Props) {
  const initial = useMemo(() => Object.fromEntries(issues.map((issue) => [issue.id, { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' }])), [issues]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  useEffect(() => setDrafts(initial), [initial]);
  const changed = issues.some((issue) => {
    const draft = drafts[issue.id];
    return draft && (draft.tocText !== (issue.toc?.text ?? '') || draft.contentText !== (issue.content?.text ?? ''));
  });
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const visibleIssues = issues.filter((issue) => !excludedIds.includes(issue.id));
  const allMatched = visibleIssues.every((issue) => {
    const draft = drafts[issue.id];
    return draft?.tocText.trim() && draft?.contentText.trim() && draft.tocText === draft.contentText;
  });

  function currentEdits(source = drafts) {
    return issues.map((issue) => ({ issueId: issue.id, tocText: source[issue.id]?.tocText ?? '', contentText: source[issue.id]?.contentText ?? '' }));
  }

  useEffect(() => { onDraftChange?.(currentEdits(), changed); }, [drafts, changed, issues]);

  function update(id: string, side: 'tocText' | 'contentText', value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { tocText: '', contentText: '' }), [side]: value } }));
  }

  return <section className="panel check-page-panel">
    <div className="check-page-heading-row">
      <h2 className="check-page-title">목차</h2>
      <div className="check-page-heading-actions">
        <span className={`check-status ${visibleIssues.length === 0 || allMatched ? 'is-success' : 'is-failure'}`}>{visibleIssues.length === 0 || allMatched ? '통과' : `${visibleIssues.filter((issue) => { const draft = drafts[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' }; return !(draft.tocText.trim() && draft.contentText.trim() && draft.tocText === draft.contentText); }).length}건 불일치`}</span>
        <button type="button" className="compact-action" onClick={() => onSave(currentEdits())} disabled={disabled || !changed}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l3 3v13H4V4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>저장
        </button>
      </div>
    </div>
    <div className="toc-excluded-list"><strong>비교 제외</strong><span>작가 소개</span><span>판권지</span><span>글의 순서</span></div>
    {error && <p className="error-message">{error}</p>}
    {visibleIssues.length === 0 ? <p className="check-detail-success">{issues.length === 0 ? 'TOC와 CONTENT가 일치합니다.' : '비교할 항목이 없습니다.'}</p> : <div className="toc-compare-list">
      {visibleIssues.map((issue) => {
        const draft = drafts[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' };
        const equal = Boolean(draft.tocText.trim() && draft.contentText.trim() && draft.tocText === draft.contentText);
        return <article key={issue.id} className={`toc-compare-row ${equal ? 'is-matched' : 'is-unmatched'}`}>
          <div className="toc-compare-file-row"><div className="toc-compare-file">{issue.toc?.href?.split('#')[0] ?? issue.content?.targetHref?.split('#')[0] ?? '목차 항목'}</div><button type="button" className="toc-exclude-button" onClick={() => setExcludedIds((current) => [...current, issue.id])} disabled={disabled}>제외</button></div>
          <div className="toc-compare-columns">
            <label className="toc-compare-side"><span>TOC</span><input value={draft.tocText} onChange={(event) => update(issue.id, 'tocText', event.target.value)} placeholder="TOC 텍스트" disabled={disabled} /></label>
            <label className="toc-compare-side"><span>CONTENT</span><input value={draft.contentText} onChange={(event) => update(issue.id, 'contentText', event.target.value)} placeholder="CONTENT 텍스트" disabled={disabled} /></label>
          </div>
          <span className={`toc-row-status ${equal ? 'is-matched' : 'is-unmatched'}`}>{equal ? '일치' : '불일치'}</span>
        </article>;
      })}
    </div>}
  </section>;
}
