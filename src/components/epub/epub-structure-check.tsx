'use client';

import { useState } from 'react';
import type { EpubMetadataChecks, FileCheckResult } from '../../types/epub';
import { displayEpubPath } from '../../lib/epub/epub-utils';

function Status({ ok }: { ok: boolean }) {
  return <span className={`check-status ${ok ? 'is-success' : 'is-failure'}`}>{ok ? '통과' : '실패'}</span>;
}

function StructureFailure({
  item, disabled, onFixSectionType, existingPaths,
}: {
  item: NonNullable<FileCheckResult['unmatchedDetails']>[number];
  disabled: boolean;
  onFixSectionType: (file: string, sectionIndex: number, sectionType: 'preface' | 'chapter', newFileName?: string) => void;
  existingPaths: string[];
}) {
  const [prefaceName, setPrefaceName] = useState('preface');
  const [editingPreface, setEditingPreface] = useState(false);
  const cleanBase = prefaceName.trim().replace(/\.xhtml$/i, '');
  const targetName = `${cleanBase}.xhtml`;
  const directory = item.file.includes('/') ? item.file.slice(0, item.file.lastIndexOf('/') + 1) : '';
  const targetPath = `${directory}${targetName}`;
  const collision = existingPaths.some((path) => path.toLowerCase() === targetPath.toLowerCase() && path !== item.file);
  const valid = /^preface[^/]*$/i.test(cleanBase);
  return <div className="structure-failure">
    <div className="structure-choice-row">
      <strong>{displayEpubPath(item.file).split('/').pop()}</strong>
      <div className="structure-choice-actions">
        <button type="button" onClick={() => { setPrefaceName('preface'); setEditingPreface(true); }} disabled={disabled}>preface</button>
        <button type="button" onClick={() => onFixSectionType(item.file, item.sectionIndex, 'chapter')} disabled={disabled}>chapter</button>
      </div>
    </div>
    {editingPreface && <div className="structure-preface-rename">
      <label>새 파일명</label>
      <div><input value={prefaceName} onChange={(event) => setPrefaceName(event.target.value)} placeholder="preface" /><button type="button" disabled={disabled || !valid || collision} onClick={() => onFixSectionType(item.file, item.sectionIndex, 'preface', targetName)}>적용</button></div>
      {collision && <p className="structure-preface-warning">같은 파일명이 EPUB 안에 이미 존재합니다.</p>}
    </div>}
  </div>;
}

function StructureItem({
  label, value, disabled, onFixSectionType, existingPaths,
}: {
  label: string; value: FileCheckResult; disabled: boolean;
  onFixSectionType: (file: string, sectionIndex: number, sectionType: 'preface' | 'chapter', newFileName?: string) => void;
  existingPaths: string[];
}) {
  const [open, setOpen] = useState(false);
  const ok = value.unmatched === 0;
  return <div className={`check-item ${open ? 'is-open' : ''}`}>
    <button type="button" className="check-item-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={`check-triangle ${open ? 'is-active' : ''}`} aria-hidden="true" />
      <span className="check-item-label">{label}</span><Status ok={ok} />
    </button>
    {open && <div className="check-detail-box">
      {ok ? <p className="check-detail-success">모든 항목이 정상입니다.</p> : value.unmatchedDetails?.length ? value.unmatchedDetails.map((item, index) => <StructureFailure key={`${item.file}-${item.sectionIndex}-${index}`} item={item} disabled={disabled} onFixSectionType={onFixSectionType} existingPaths={existingPaths} />) : value.unmatchedFiles.map((file) => <div className="structure-failure-line" key={file}>{displayEpubPath(file).split('/').pop()}</div>)}
    </div>}
  </div>;
}

export default function EpubStructureCheck({
  checks,
  disabled,
  onFixLanguage,
  onFixSectionType,
}: {
  checks: EpubMetadataChecks;
  disabled: boolean;
  onFixLanguage: () => void;
  onFixSectionType: (file: string, sectionIndex: number, sectionType: 'preface' | 'chapter', newFileName?: string) => void;
}) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageOk = checks.language.unmatched === 0;
  return <section className="panel check-page-panel">
    <h2 className="check-page-title">구조 및 언어</h2>
    <div className={`check-item ${languageOpen ? 'is-open' : ''}`}>
      <button type="button" className="check-item-trigger" onClick={() => languageOk ? undefined : setLanguageOpen((v) => !v)} aria-expanded={languageOpen} disabled={languageOk}>
        <span className={`check-triangle ${languageOpen ? 'is-active' : ''}`} aria-hidden="true" />
        <span className="check-item-label">언어</span>
        <Status ok={languageOk} />
      </button>
      {languageOpen && !languageOk && <div className="check-detail-box">
        <div className="check-detail-heading"><span>언어 수정</span><button type="button" className="compact-action" onClick={onFixLanguage} disabled={disabled}>수정</button></div>
        {checks.language.fileValues?.filter((item) => item.lang !== 'ko' || item.xmlLang !== 'ko').map((item) => <div className="language-file-row" key={item.file}><strong>{displayEpubPath(item.file).split('/').pop()}</strong><span>lang: {item.lang ?? '없음'} · xml:lang: {item.xmlLang ?? '없음'}</span></div>)}
      </div>}
    </div>
    <StructureItem label="section 속성" value={checks.chapter} disabled={disabled} onFixSectionType={onFixSectionType} existingPaths={checks.epubFilePaths ?? []} />
  </section>;
}
