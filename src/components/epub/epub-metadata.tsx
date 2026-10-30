"use client";

import { useState } from "react";
import type { EpubMetadata } from "../../types/epub";

interface Props {
  metadata: EpubMetadata;
  onSave: (metadata: EpubMetadata) => Promise<void>;
}

export default function EpubMetadataSection({ metadata, onSave }: Props) {
  const [title, setTitle] = useState(metadata.title);
  const [creator, setCreator] = useState(metadata.creator);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await onSave({ title: title.trim(), creator: creator.trim() });
      setMessage("메타데이터가 적용되었습니다.");
    } catch {
      setMessage("메타데이터 수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 panel">
      <h2 className="mb-4 text-xl font-bold">EPUB 메타데이터</h2>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">도서 제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="metadata-input" />
        </label>
        <label className="block text-sm font-medium">저자
          <input value={creator} onChange={(event) => setCreator(event.target.value)} className="metadata-input" />
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "적용 중..." : "메타데이터 적용"}</button>
          {message && <span className="text-sm text-gray-600">{message}</span>}
        </div>
      </form>
    </section>
  );
}
