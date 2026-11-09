'use client';

import { useEffect, useState } from 'react';
import type { EpubMetadata } from '../../types/epub';
import { BOOK_REFERENCES } from '../../lib/epub/book-references';

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
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').trim();
  const matchedBook = BOOK_REFERENCES.find((book) => normalize(book.title) === normalize(title));
  const titleMatched = Boolean(matchedBook);
  const authorMatched = Boolean(matchedBook && normalize(matchedBook.creator) === normalize(creator));
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
        <h2 className="text-xl font-bold">기본 정보</h2>
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
          <span className="metadata-field-heading">도서 제목 <span className={titleMatched ? 'metadata-match-mark is-match' : 'metadata-match-mark is-mismatch'} aria-label={titleMatched ? '일치' : '불일치'}>{titleMatched ? 'O' : 'X'}</span></span>
          <input
            value={title}
            onChange={(event) => updateDraft(event.target.value, creator)}
            className="metadata-input"
          />
        </label>
        <label className="block text-sm font-medium">
          <span className="metadata-field-heading">저자 <span className={authorMatched ? 'metadata-match-mark is-match' : 'metadata-match-mark is-mismatch'} aria-label={authorMatched ? '일치' : '불일치'}>{authorMatched ? 'O' : 'X'}</span></span>
          <input
            value={creator}
            onChange={(event) => updateDraft(title, event.target.value)}
            className="metadata-input"
          />
        </label>
      </form>
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
