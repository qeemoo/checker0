'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TocContentEntry, TocContentIssue } from '../../types/epub';
import { displayEpubPath } from '../../lib/epub/epub-utils';

interface Props {
  issues: TocContentIssue[];
  tocEntries: TocContentEntry[];
  contentEntries: TocContentEntry[];
  error?: string;
  onSave: (edits: { issueId: string; tocText: string; contentText: string }[]) => Promise<boolean>;
  onDelete?: (issue: TocContentIssue) => Promise<boolean>;
  onSaveExcludedTitles?: (titles: string[]) => void;
  excludedTitles?: string[];
  disabled: boolean;
  onDraftChange?: (edits: { issueId: string; tocText: string; contentText: string }[], changed: boolean) => void;
}

type Draft = { tocText: string; contentText: string };
type AlignedPair = { toc?: TocContentEntry; content?: TocContentEntry; excluded?: boolean };
const DEFAULT_EXCLUDED = ['2026 읽기쉬운책 160권을 소개합니다', '판권지', '글의 순서'];
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const alignText = (value: string) => normalize(value).replace(/^[•●○◦▪▫■□◆◇‣⁃∙·]+\s*/u, '');

function alignAllEntries(tocEntries: TocContentEntry[], contentEntries: TocContentEntry[], excludedTitles: string[]): AlignedPair[] {
  const excluded = (entry?: TocContentEntry) => Boolean(entry && excludedTitles.some((title) => normalize(title) === normalize(entry.text)));
  const rows = tocEntries.length + 1;
  const columns = contentEntries.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      dp[i][j] = alignText(tocEntries[i - 1].text) === alignText(contentEntries[j - 1].text)
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matches: Array<[number, number]> = [];
  let i = tocEntries.length;
  let j = contentEntries.length;
  while (i > 0 && j > 0) {
    if (alignText(tocEntries[i - 1].text) === alignText(contentEntries[j - 1].text)) {
      matches.push([i - 1, j - 1]); i -= 1; j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1;
    else j -= 1;
  }
  matches.reverse();
  const result: AlignedPair[] = [];
  let previousToc = -1;
  let previousContent = -1;
  const appendGap = (tocGap: TocContentEntry[], contentGap: TocContentEntry[]) => {
    let ti = 0;
    let ci = 0;
    while (ti < tocGap.length || ci < contentGap.length) {
      const t = tocGap[ti];
      const c = contentGap[ci];
      if (excluded(t) && excluded(c) && alignText(t!.text) === alignText(c!.text)) {
        result.push({ toc: t, content: c, excluded: true }); ti += 1; ci += 1;
      } else if (excluded(t)) {
        result.push({ toc: t, excluded: true }); ti += 1;
      } else if (excluded(c)) {
        result.push({ content: c, excluded: true }); ci += 1;
      } else if (t && c) {
        result.push({ toc: t, content: c }); ti += 1; ci += 1;
      } else if (t) {
        result.push({ toc: t }); ti += 1;
      } else if (c) {
        result.push({ content: c }); ci += 1;
      }
    }
  };
  for (const [tocIndex, contentIndex] of matches) {
    appendGap(tocEntries.slice(previousToc + 1, tocIndex), contentEntries.slice(previousContent + 1, contentIndex));
    const matchedToc = tocEntries[tocIndex];
    const matchedContent = contentEntries[contentIndex];
    result.push({ toc: matchedToc, content: matchedContent, excluded: excluded(matchedToc) || excluded(matchedContent) });
    previousToc = tocIndex; previousContent = contentIndex;
  }
  appendGap(tocEntries.slice(previousToc + 1), contentEntries.slice(previousContent + 1));
  return result;
}

function createIssue(pair: AlignedPair, issues: TocContentIssue[]): TocContentIssue {
  const found = issues.find((issue) => issue.toc?.index === pair.toc?.index && issue.content?.index === pair.content?.index);
  if (found) return found;
  return {
    id: `full-${pair.toc?.index ?? 'x'}-${pair.content?.index ?? 'x'}`,
    kind: pair.toc && pair.content ? 'text' : pair.toc ? 'missing-in-content' : 'missing-in-toc',
    toc: pair.toc ?? null,
    content: pair.content ?? null,
    canAddToToc: Boolean(pair.content?.targetHref),
    canAddToContent: Boolean(pair.toc?.href),
  };
}

export default function EpubTocContentResults({
  issues, tocEntries, contentEntries, error, onSave, onDelete, onSaveExcludedTitles, excludedTitles: savedExcludedTitles = DEFAULT_EXCLUDED, disabled, onDraftChange,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [excludedTitles, setExcludedTitles] = useState<string[]>(savedExcludedTitles);
  const [newExcludedTitle, setNewExcludedTitle] = useState('');
  const [selectedEditIssue, setSelectedEditIssue] = useState<TocContentIssue | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TocContentIssue | null>(null);

  useEffect(() => setExcludedTitles(savedExcludedTitles), [savedExcludedTitles]);
  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const issue of issues) {
        if (!next[issue.id]) next[issue.id] = { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' };
      }
      return next;
    });
  }, [issues]);

  const visibleIssues = useMemo(() => issues.filter((issue) => {
    const texts = [issue.toc?.text, issue.content?.text].filter(Boolean).map((text) => normalize(text as string));
    return !excludedTitles.some((title) => texts.includes(normalize(title)));
  }), [issues, excludedTitles]);

  const pairedAllEntries = useMemo(() => alignAllEntries(tocEntries, contentEntries, excludedTitles), [tocEntries, contentEntries, excludedTitles]);
  const editableIssues = useMemo(() => {
    const list = [...visibleIssues];
    if (selectedEditIssue && !list.some((item) => item.id === selectedEditIssue.id)) list.unshift(selectedEditIssue);
    return list;
  }, [visibleIssues, selectedEditIssue]);
  const changedIssues = useMemo(() => editableIssues.filter((issue) => {
    const draft = drafts[issue.id];
    return Boolean(draft && (draft.tocText !== (issue.toc?.text ?? '') || draft.contentText !== (issue.content?.text ?? '')));
  }), [editableIssues, drafts]);
  const savableIssues = useMemo(() => changedIssues.filter((issue) => {
    const draft = drafts[issue.id]!;
    return Boolean(draft.tocText.trim() && draft.contentText.trim() && normalize(draft.tocText) === normalize(draft.contentText));
  }), [changedIssues, drafts]);
  const unmatchedCount = visibleIssues.filter((issue) => {
    const draft = drafts[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' };
    return !(draft.tocText.trim() && draft.contentText.trim() && normalize(draft.tocText) === normalize(draft.contentText));
  }).length + (selectedEditIssue && !visibleIssues.some((issue) => issue.id === selectedEditIssue.id) && (() => { const draft = drafts[selectedEditIssue.id] ?? { tocText: selectedEditIssue.toc?.text ?? '', contentText: selectedEditIssue.content?.text ?? '' }; return !(draft.tocText.trim() && draft.contentText.trim() && normalize(draft.tocText) === normalize(draft.contentText)); })() ? 1 : 0);
  const exclusionsChanged = excludedTitles.length !== savedExcludedTitles.length || excludedTitles.some((title) => !savedExcludedTitles.some((saved) => normalize(saved) === normalize(title)));
  const hasPendingSave = exclusionsChanged || savableIssues.length > 0;

  function currentEdits(source = drafts, selectedIssues = savableIssues) {
    return selectedIssues.map((issue) => ({ issueId: issue.id, tocText: source[issue.id]?.tocText ?? '', contentText: source[issue.id]?.contentText ?? '' }));
  }

  useEffect(() => {
    onDraftChange?.(currentEdits(), changedIssues.length > 0);
  }, [drafts, savableIssues, changedIssues.length]);

  function startEdit(pair: AlignedPair) {
    const issue = createIssue(pair, issues);
    setSelectedEditIssue(issue);
    setDrafts((current) => ({ ...current, [issue.id]: current[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' } }));
  }

  function update(id: string, side: 'tocText' | 'contentText', value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { tocText: '', contentText: '' }), [side]: value } }));
  }

  function addExcludedTitle() {
    const title = newExcludedTitle.trim();
    if (!title || excludedTitles.some((item) => normalize(item) === normalize(title))) return;
    setExcludedTitles((current) => [...current, title]);
    if (selectedEditIssue && [selectedEditIssue.toc?.text, selectedEditIssue.content?.text].some((text) => text && normalize(text) === normalize(title))) setSelectedEditIssue(null);
    setNewExcludedTitle('');
  }

  function excludeIssue(issue: TocContentIssue) {
    const titles = [issue.toc?.text, issue.content?.text].filter((value): value is string => Boolean(value?.trim()));
    setExcludedTitles((current) => [...current, ...titles.filter((title) => !current.some((item) => normalize(item) === normalize(title)))]);
    if (selectedEditIssue?.id === issue.id) setSelectedEditIssue(null);
  }

  async function saveAll() {
    if (disabled || saving) return;
    setSaving(true);
    try {
      const edits = currentEdits();
      if (edits.length && !(await onSave(edits))) return;
      onSaveExcludedTitles?.(excludedTitles);
      // 저장 후 분석 결과의 행 인덱스가 다시 매겨지므로 이전 행의 임시 입력값을 폐기합니다.
      setDrafts({});
      setSelectedEditIssue(null);
    } finally {
      setSaving(false);
    }
  }

  async function saveSelected(issue: TocContentIssue) {
    const draft = drafts[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' };
    if (!draft.tocText.trim() || !draft.contentText.trim() || normalize(draft.tocText) !== normalize(draft.contentText)) return;
    setSaving(true);
    try {
      if (await onSave([{ issueId: issue.id, ...draft }])) {
        // 저장 후 TOC/CONTENT 목록이 재분석되므로 이전 인덱스에 묶인 초안을 남기지 않습니다.
        setDrafts({});
        setSelectedEditIssue(null);
      }
    } finally { setSaving(false); }
  }

  async function deleteSelected(issue: TocContentIssue) {
    if (!onDelete || disabled || saving) return;
    setPendingDelete(issue);
  }

  async function confirmDelete() {
    if (!pendingDelete || !onDelete || disabled || saving) return;
    setSaving(true);
    try {
      if (await onDelete(pendingDelete)) {
        // 삭제로 행 인덱스가 이동해도 다음 행에 이전 행의 입력값이 표시되지 않도록 초기화합니다.
        setDrafts({});
        setSelectedEditIssue(null);
        setPendingDelete(null);
      }
    } finally { setSaving(false); }
  }

  function renderIssue(issue: TocContentIssue) {
    const draft = drafts[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' };
    const equal = Boolean(draft.tocText.trim() && draft.contentText.trim() && normalize(draft.tocText) === normalize(draft.contentText));
    return <article key={issue.id} className="toc-inline-edit-card">
      <div className="toc-compare-columns">
        <label className="toc-compare-side"><span>TOC</span><input aria-label="TOC 텍스트" value={draft.tocText} onChange={(event) => update(issue.id, 'tocText', event.target.value)} placeholder="목차 텍스트" disabled={disabled} /></label>
        <label className="toc-compare-side"><span>CONTENT</span><input aria-label="CONTENT 텍스트" value={draft.contentText} onChange={(event) => update(issue.id, 'contentText', event.target.value)} placeholder="본문 텍스트" disabled={disabled} /></label>
      </div>
      <div className="toc-inline-edit-actions"><button type="button" className="compact-action" onClick={() => void saveSelected(issue)} disabled={disabled || saving || !equal}>{saving ? '저장 중…' : '저장'}</button><button type="button" className="compact-action image-delete-button" onClick={() => void deleteSelected(issue)} disabled={disabled || saving}>삭제</button></div>
    </article>;
  }

  return <section className="panel check-page-panel">
    <div className="check-page-heading-row"><h2 className="check-page-title">목차</h2><div className="check-page-heading-actions"><span className={`check-status ${unmatchedCount === 0 ? 'is-success' : 'is-failure'}`}>{unmatchedCount === 0 ? '통과' : `${unmatchedCount}건 불일치`}</span></div></div>

    <div className="toc-excluded-list">
      <div className="toc-excluded-heading"><strong>제외</strong>{hasPendingSave && <button type="button" className="compact-action" onClick={() => void saveAll()} disabled={disabled || saving}>{saving ? '저장 중…' : '저장'}</button>}</div>
      <div className="toc-excluded-tags">{excludedTitles.map((title) => <span className="toc-excluded-tag" key={title}>{title}{!DEFAULT_EXCLUDED.some((item) => normalize(item) === normalize(title)) && <button type="button" aria-label={`${title} 제외 해제`} onClick={() => setExcludedTitles((current) => current.filter((item) => item !== title))} disabled={disabled}>×</button>}</span>)}</div>
      <div className="toc-excluded-add-row"><label htmlFor="toc-excluded-title">제외</label><form className="toc-excluded-add" onSubmit={(event) => { event.preventDefault(); addExcludedTitle(); }}><input id="toc-excluded-title" value={newExcludedTitle} onChange={(event) => setNewExcludedTitle(event.target.value)} placeholder="목차 제목 입력" disabled={disabled} /><button type="submit" className="compact-action" disabled={disabled || !newExcludedTitle.trim()}>추가</button></form></div>
    </div>

    <section className="toc-full-comparison is-always-open">
      <h3 className="toc-full-comparison-title">전체 목차</h3>
      <div className="toc-full-comparison-list">
        <div className="toc-full-comparison-header"><strong>TOC</strong><strong>CONTENT</strong><span /></div>
        {pairedAllEntries.map((pair) => {
          const issue = createIssue(pair, issues);
          const selected = selectedEditIssue?.id === issue.id;
          const equal = Boolean(pair.toc && pair.content && normalize(pair.toc.text) === normalize(pair.content.text));
          const mismatch = !pair.excluded && !equal;
          return <div key={issue.id} className="toc-full-entry-wrap">
            <article className={`toc-full-comparison-row ${mismatch ? 'is-unmatched' : 'is-matched'} ${pair.excluded ? 'is-excluded' : ''}`}>
              <div className="toc-full-cell">{pair.toc && <span>{pair.toc.text}</span>}</div>
              <div className="toc-full-cell">{pair.content && <span>{pair.content.text}</span>}</div>
              <button type="button" className="toc-full-edit-button" disabled={disabled || pair.excluded} onClick={() => { if (selected) setSelectedEditIssue(null); else { setSelectedEditIssue(issue); setDrafts((current) => ({ ...current, [issue.id]: current[issue.id] ?? { tocText: issue.toc?.text ?? '', contentText: issue.content?.text ?? '' } })); } }}>{pair.excluded ? '제외' : selected ? '닫기' : '수정'}</button>
            </article>
            {selected && <div className="toc-edit-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEditIssue(null); }}>
              <section className="toc-edit-modal-surface" role="dialog" aria-modal="true" aria-labelledby="toc-edit-modal-title">
                <header className="toc-edit-modal-header"><h3 id="toc-edit-modal-title">목차 항목 수정</h3><button type="button" onClick={() => setSelectedEditIssue(null)} aria-label="닫기">×</button></header>
                {renderIssue(issue)}
              </section>
            </div>}
          </div>;
        })}
      </div>
    </section>

    {pendingDelete && <div className="toc-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setPendingDelete(null); }}>
      <section className="toc-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="toc-delete-title" aria-describedby="toc-delete-description">
        <div className="toc-confirm-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v5m0 2.5v.1"/></svg></div>
        <h3 id="toc-delete-title">목차 항목 삭제</h3>
        <p id="toc-delete-description">선택한 항목을 TOC와 CONTENT에서 삭제하시겠습니까?</p>
        <div className="toc-confirm-item"><span>TOC</span><strong>{pendingDelete.toc?.text || '항목 없음'}</strong><span>CONTENT</span><strong>{pendingDelete.content?.text || '항목 없음'}</strong></div>
        <div className="toc-confirm-actions"><button type="button" className="toc-confirm-cancel" onClick={() => setPendingDelete(null)} disabled={saving}>취소</button><button type="button" className="toc-confirm-delete" onClick={() => void confirmDelete()} disabled={saving}>{saving ? '삭제 중…' : '삭제'}</button></div>
      </section>
    </div>}
    {error && <p className="error-message">{error}</p>}
  </section>;
}
