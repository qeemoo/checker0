'use client';

import { useEffect, useState } from 'react';
import type { EpubMetadata } from '../../types/epub';

interface Props {
  metadata: EpubMetadata;
  draftMetadata: EpubMetadata;
  onDraftChange: (metadata: EpubMetadata) => void;
  onSave: (metadata: EpubMetadata) => Promise<void>;
}

export default function EpubMetadataSection({ metadata, draftMetadata, onDraftChange, onSave }: Props) {
  const [title, setTitle] = useState(draftMetadata.title);
  const [creator, setCreator] = useState(draftMetadata.creator);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState<EpubMetadata>({ title: '', creator: '' });
  const [referenceDraft, setReferenceDraft] = useState<EpubMetadata>({ title: '', creator: '' });
  const [referenceSaved, setReferenceSaved] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('checker0-book-reference-v1');
      if (!saved) return;
      const parsed = JSON.parse(saved) as EpubMetadata;
      const next = { title: String(parsed.title ?? ''), creator: String(parsed.creator ?? '') };
      setReference(next);
      setReferenceDraft(next);
      setReferenceSaved(Boolean(next.title && next.creator));
    } catch { /* invalid browser storage; leave reference empty */ }
  }, []);

  function saveReference() {
    const next = { title: referenceDraft.title.trim(), creator: referenceDraft.creator.trim() };
    if (!next.title || !next.creator) return;
    try {
      window.localStorage.setItem('checker0-book-reference-v1', JSON.stringify(next));
      setReference(next);
      setReferenceSaved(true);
    } catch { setToast({ type: 'error', message: '기준 도서 정보를 저장하지 못했습니다.' }); }
  }

  const normalize = (value: string) => value.normalize('NFKC').replace(/\\s+/g, '').trim();
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const hasChanges = title.trim() !== metadata.title || creator.trim() !== metadata.creator;

  useEffect(() => {
    setTitle(draftMetadata.title);
    setCreator(draftMetadata.creator);
  }, [draftMetadata.title, draftMetadata.creator]);

  function updateDraft(nextTitle: string, nextCreator: string) {
    setTitle(nextTitle);
    setCreator(nextCreator);
    onDraftChange({ title: nextTitle, creator: nextCreator });
  }

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanges || saving) return;

    setSaving(true);
    setToast(null);
    try {
      await onSave({ title: title.trim(), creator: creator.trim() });
      setToast({ type: 'success', message: '적용되었습니다.' });
    } catch {
      setToast({ type: 'error', message: '실패했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 panel metadata-panel">
      <div className="metadata-heading-row">
        <h2 className="text-xl font-bold">메타데이터 입력</h2>
        <button
          type="submit"
          form="epub-metadata-form"
          disabled={!hasChanges || saving}
          className="btn-primary metadata-save-button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3h12l4 4v14H3V3z" />
            <path d="M7 3v6h10V3M7 21v-8h10v8" />
          </svg>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
      <form id="epub-metadata-form" onSubmit={submit} className="metadata-form">
        <label className="block text-sm font-medium">
          도서 제목
          <input
            value={title}
            onChange={(event) => updateDraft(event.target.value, creator)}
            className="metadata-input"
          />
        </label>
        <label className="block text-sm font-medium">
          저자
          <input
            value={creator}
            onChange={(event) => updateDraft(title, event.target.value)}
            className="metadata-input"
          />
        </label>
      </form>
      <div className="metadata-reference-check">
        <div className="metadata-reference-heading">
          <div>
            <h3>기준 도서 정보 대조</h3>
            <p>완성된 EPUB의 메타데이터와 비교할 기준값입니다. 이 브라우저에 저장되며 다른 기기와 동기화되지 않습니다.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={saveReference} disabled={!referenceDraft.title.trim() || !referenceDraft.creator.trim()}>기준 정보 저장</button>
        </div>
        <div className="metadata-reference-fields">
          <label>기준 도서 제목<input className="metadata-input" value={referenceDraft.title} onChange={(event) => setReferenceDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="나중에 입력할 도서 제목" /></label>
          <label>기준 저자<input className="metadata-input" value={referenceDraft.creator} onChange={(event) => setReferenceDraft((prev) => ({ ...prev, creator: event.target.value }))} placeholder="나중에 입력할 저자명" /></label>
        </div>
        {!referenceSaved ? <p className="metadata-reference-pending">기준 도서 정보 미등록 · 대조 대기</p> : (
          <div className="metadata-reference-results">
            <p className={normalize(reference.title) === normalize(metadata.title) ? 'status-success' : 'status-failure'}>제목: {normalize(reference.title) === normalize(metadata.title) ? '일치' : '불일치'} · EPUB: {metadata.title || '(없음)'}</p>
            <p className={normalize(reference.creator) === normalize(metadata.creator) ? 'status-success' : 'status-failure'}>저자: {normalize(reference.creator) === normalize(metadata.creator) ? '일치' : '불일치'} · EPUB: {metadata.creator || '(없음)'}</p>
          </div>
        )}
      </div>
      {toast && (
        <div
          className={`metadata-toast ${toast.type === 'success' ? 'is-success' : 'is-error'}`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </section>
  );
}
