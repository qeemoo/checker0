'use client';

import { useEffect, useState } from 'react';
import type { EpubMetadata } from '../../types/epub';

interface Props {
  metadata: EpubMetadata;
  onSave: (metadata: EpubMetadata) => Promise<void>;
}

export default function EpubMetadataSection({ metadata, onSave }: Props) {
  const [title, setTitle] = useState(metadata.title);
  const [creator, setCreator] = useState(metadata.creator);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const hasChanges = title.trim() !== metadata.title || creator.trim() !== metadata.creator;

  useEffect(() => {
    setTitle(metadata.title);
    setCreator(metadata.creator);
  }, [metadata.title, metadata.creator]);

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
        <h2 className="text-xl font-bold">메타데이터</h2>
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
            onChange={(event) => setTitle(event.target.value)}
            className="metadata-input"
          />
        </label>
        <label className="block text-sm font-medium">
          저자
          <input
            value={creator}
            onChange={(event) => setCreator(event.target.value)}
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
