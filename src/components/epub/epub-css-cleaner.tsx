'use client';

import { useState } from 'react';
import type { CssCleanupPreview } from '../../lib/epub/clean-css';

interface Props { preview: CssCleanupPreview | null; selectedFiles: string[]; onCleanFiles: (files: string[]) => void; disabled?: boolean; error?: string }

function HighlightedPreview({ value }: { value: string }) {
  const parts = value.split(/(\.[CBF][0-9A-F]{6})/g);
  return <pre className="css-code-preview">{parts.map((part, index) => /^\.[CBF][0-9A-F]{6}$/.test(part) ? <mark className="css-class-highlight" key={index}>{part}</mark> : part)}</pre>;
}

export default function EpubCssCleaner({ preview, selectedFiles, onCleanFiles, disabled = false, error = '' }: Props) {
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  function toggle(path: string) { setOpenFiles((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]); }
  if (!preview && !error) return null;
  return <section className="panel check-page-panel">
    <div className="check-page-heading-row"><h2 className="check-page-title">CSS</h2><button type="button" className="compact-action" onClick={() => onCleanFiles(preview?.cssFiles ?? [])} disabled={disabled || !preview || !preview.cssFiles.length}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 2 13h12l2-13M3 7h18M9 7V4h6v3"/></svg>전체 정리</button></div>
    {error && <p className="error-message">{error}</p>}
    {preview && <>
      <div className="css-summary-row"><div className="css-summary-item"><span>사용 색상</span><strong>{preview.colors.length}</strong></div><div className="css-summary-item"><span>클래스 수정</span><strong>{preview.renamedClasses}</strong></div></div>
      <div className="css-file-list">{preview.previewsByFile.map((item) => {
        const isOpen = openFiles.includes(item.path);
        const selected = selectedFiles.includes(item.path);
        return <article className={`css-file-item ${isOpen ? 'is-open' : ''}`} key={item.path}>
          <div className="css-file-row"><button type="button" className="css-file-toggle" onClick={() => toggle(item.path)} aria-expanded={isOpen}><span className={`check-triangle ${isOpen ? 'is-active' : ''}`} /><span><strong>{item.path}</strong><small>사용 색상 {item.colors.length} · 클래스 수정 {item.renamedClasses}</small></span></button><button type="button" className="compact-action" onClick={() => onCleanFiles([item.path])} disabled={disabled}>{selected ? '정리 예약됨' : '정리'}</button></div>
          {isOpen && <div className="css-file-preview"><div className="css-preview-caption">클래스명 변경 항목은 강조 표시됩니다.</div>{item.classRenames.length > 0 && <div className="css-renamed-class-list">{item.classRenames.map((rename) => <div key={`${rename.from}-${rename.to}`}><code>{rename.from}</code><span>→</span><mark>{rename.to}</mark></div>)}</div>}{item.previewCss ? <HighlightedPreview value={item.previewCss} /> : <p>표시할 색상 규칙이 없습니다.</p>}</div>}
        </article>;
      })}</div>
      {selectedFiles.length > 0 && <p className="css-selected-note">{selectedFiles.length}개 CSS 파일의 정리가 EPUB에 반영됩니다.</p>}
    </>}
  </section>;
}
