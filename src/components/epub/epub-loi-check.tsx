'use client';

import { useRef, useState } from 'react';
import type { LoiFigurePreview, EpubMetadataChecks } from '../../types/epub';
import { LoiCheckRow } from './epub-check-ui';
import { displayEpubPath } from '../../lib/epub/epub-utils';

export default function EpubLoiCheck({
  checks,
  disabled = false,
  onSaveCaption,
  onReplaceImage,
}: {
  checks: EpubMetadataChecks;
  disabled?: boolean;
  onSaveCaption: (item: LoiFigurePreview, caption: string) => Promise<boolean>;
  onReplaceImage: (item: LoiFigurePreview, file: File) => Promise<boolean>;
}) {
  const previews = checks.loiFigurePreviews ?? [];
  const [selectedPreview, setSelectedPreview] = useState<LoiFigurePreview | null>(null);
  const [editingItem, setEditingItem] = useState<LoiFigurePreview | null>(null);
  const [draftCaption, setDraftCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function itemKey(item: LoiFigurePreview, index: number) { return `${item.xhtmlFile}|${item.id}|${item.caption}|${item.imagePaths.join('|')}|${index}`; }
  function startEdit(item: LoiFigurePreview) { setEditingItem({ ...item, imagePaths: [...item.imagePaths] }); setDraftCaption(item.caption); }
  function cancelEdit() { setEditingItem(null); setDraftCaption(''); }

  async function saveEdit() {
    if (!editingItem || disabled || !draftCaption.trim()) return;
    const saved = await onSaveCaption(editingItem, draftCaption.trim());
    if (saved) cancelEdit();
  }

  async function replaceSelectedImage(file?: File) {
    if (!selectedPreview || !file) return;
    const saved = await onReplaceImage(selectedPreview, file);
    if (saved) setSelectedPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return <section className="panel check-page-panel">
    <h2 className="check-page-title">이미지 목차</h2>
    <h3 className="loi-missing-heading">누락 확인</h3>
    <LoiCheckRow label="ID" value={checks.loiImageNumbers} />
    <LoiCheckRow label="figcap" value={checks.loiFigcapMissing} />
    <LoiCheckRow label="목차" value={checks.loiTocMissing} />
    <h3 className="loi-missing-heading loi-duplicate-heading">중복 확인</h3>
    <LoiCheckRow label="중복" value={checks.loiImageDuplicates} />
    {previews.length > 0 && <section className="loi-image-list">
      <h3>이미지 목차</h3>
      <ul>{previews.map((item, index) => {
        const key = itemKey(item, index);
        const imageNames = item.imagePaths.map((path) => displayEpubPath(path).split('/').pop() || displayEpubPath(path));
        const xhtmlName = `${displayEpubPath(item.xhtmlFile).split('/').pop() || displayEpubPath(item.xhtmlFile)}${item.id ? `#${item.id}` : ''}`;
        return <li className={item.hasIssue ? 'has-issue' : ''} key={key}>
          <div className="loi-image-description">
            <div className="loi-image-files"><strong>{xhtmlName}</strong><span>({imageNames.join(', ')})</span></div>
            <div className="loi-image-caption">{item.caption || '캡션 없음'}</div>
          </div>
          <div className="loi-image-row-actions">
            <button type="button" className="loi-image-edit-button" disabled={disabled} onClick={() => startEdit(item)}>수정</button>
            <button type="button" className="loi-image-view-button" onClick={() => setSelectedPreview(item)}>보기</button>
          </div>
        </li>;
      })}</ul>
    </section>}

    {editingItem && <div className="loi-image-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelEdit(); }}>
      <section className="loi-caption-edit-modal loi-modal-surface" role="dialog" aria-modal="true" aria-labelledby="loi-caption-edit-title">
        <div className="loi-caption-edit-modal-header"><h3 id="loi-caption-edit-title">이미지 설명 수정</h3><button type="button" className="loi-modal-close" onClick={cancelEdit} aria-label="닫기">×</button></div>
        <p className="loi-caption-edit-location">{displayEpubPath(editingItem.xhtmlFile)}#{editingItem.id}</p>
        <textarea value={draftCaption} onChange={(event) => setDraftCaption(event.target.value)} rows={7} autoFocus aria-label="이미지 설명 전체 내용" />
        <div className="loi-caption-edit-modal-actions"><button type="button" className="loi-modal-secondary" onClick={cancelEdit}>취소</button><button type="button" className="loi-modal-primary" onClick={() => void saveEdit()} disabled={disabled || !draftCaption.trim() || draftCaption.trim() === editingItem.caption}>저장</button></div>
      </section>
    </div>}

    {selectedPreview && <div className="loi-image-modal-backdrop" role="presentation" onClick={() => setSelectedPreview(null)}>
      <div className="loi-image-modal loi-modal-surface" role="dialog" aria-modal="true" aria-label="이미지 미리보기" onClick={(event) => event.stopPropagation()}>
        <div className="loi-image-modal-header"><div><strong>{selectedPreview.caption || '캡션 없음'}</strong><span>{displayEpubPath(selectedPreview.file)}</span></div><div className="loi-image-modal-actions">
          <input ref={fileInputRef} type="file" accept="image/*" disabled={disabled} onChange={(event) => void replaceSelectedImage(event.target.files?.[0])} />
          <button type="button" className="loi-image-replace-button" disabled={disabled} onClick={() => fileInputRef.current?.click()}>변경</button>
          <button type="button" className="loi-modal-close" onClick={() => setSelectedPreview(null)} aria-label="닫기">×</button>
        </div></div>
        <div className="loi-image-modal-content"><img src={selectedPreview.imageDataUrl} alt={selectedPreview.caption || '이미지 목차 미리보기'} /></div>
      </div>
    </div>}
  </section>;
}
