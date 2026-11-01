'use client';

import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { displayEpubPath } from '../../lib/epub/epub-utils';
import type { CodeIssueDetail } from '../../types/epub';

type Asset = { path: string; category: string; used: boolean; mime: string };

function resolveArchivePath(base: string, href: string) {
  const parts = `${base}${decodeURIComponent(href)}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) { if (!part || part === '.') continue; if (part === '..') normalized.pop(); else normalized.push(part); }
  return normalized.join('/');
}

function categoryOf(path: string) {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (/^pre/i.test(name)) return '장식';
  if (/^img/i.test(name)) return '정보 (이미지 목차용)';
  if (/^part/i.test(name)) return '장';
  return '기타';
}

export default function EpubImageAssets({ file, onDelete, deletedPaths = [], disabled = false, issues = [] }: { file: File; onDelete: (path: string) => Promise<boolean>; deletedPaths?: string[]; disabled?: boolean; issues?: CodeIssueDetail[] }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function scan() {
    setLoading(true);
    try {
      const zip = await JSZip.loadAsync(file);
      const container = await zip.file('META-INF/container.xml')?.async('text');
      if (!container) throw new Error('container.xml missing');
      const containerDoc = new DOMParser().parseFromString(container, 'application/xml');
      const opfPath = containerDoc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:container', 'rootfile')[0]?.getAttribute('full-path');
      if (!opfPath) throw new Error('OPF missing');
      const opf = await zip.file(opfPath)?.async('text');
      if (!opf) throw new Error('OPF missing');
      const doc = new DOMParser().parseFromString(opf, 'application/xml');
      const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      const items = Array.from(doc.getElementsByTagNameNS('http://www.idpf.org/2007/opf', 'item')).filter((item) => /image\//i.test(item.getAttribute('media-type') ?? '') || /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(item.getAttribute('href') ?? ''));
      const textFiles: string[] = [];
      for (const path of Object.keys(zip.files).filter((path) => !zip.files[path].dir && /\.(xhtml|html|css|ncx)$/i.test(path))) {
        textFiles.push(await zip.file(path)!.async('text'));
      }
      const references = textFiles.join('\n');
      const result: Asset[] = [];
      for (const item of items) {
        const href = item.getAttribute('href') ?? '';
        const path = resolveArchivePath(base, href);
        const entry = zip.file(path);
        if (!entry) continue;
        const used = references.includes(href) || references.includes(encodeURI(href)) || references.includes(path.split('/').pop() ?? '\u0000');
        result.push({ path, category: categoryOf(path), used, mime: item.getAttribute('media-type') || 'image/*' });
      }
      const listed = new Set(result.map((item) => item.path));
      for (const path of Object.keys(zip.files).filter((path) => !zip.files[path].dir && /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(path) && !listed.has(path))) {
        const used = references.includes(path.split('/').pop() ?? '\u0000');
        result.push({ path, category: categoryOf(path), used, mime: 'image/*' });
      }
      setAssets(result.filter((item) => !deletedPaths.includes(item.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })));
    } catch (error) {
      console.error('이미지 파일 목록을 읽지 못했습니다.', error);
      setAssets([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { void scan(); }, [file, deletedPaths.join('|')]);
  async function showPreview(asset: Asset) {
    const zip = await JSZip.loadAsync(file);
    const blob = await zip.file(asset.path)?.async('blob');
    if (!blob) return;
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ path: asset.path, url: URL.createObjectURL(blob) });
  }
  async function remove(asset: Asset) {
    if (!window.confirm(`다음 이미지 파일을 EPUB에서 완전히 삭제하시겠습니까?\n\n${displayEpubPath(asset.path)}\n\n참조 중인 이미지라면 문서에서 표시되지 않을 수 있습니다. 삭제 후에는 되돌릴 수 없습니다.`)) return;
    setDeleting(asset.path);
    try { if (await onDelete(asset.path)) await scan(); }
    finally { setDeleting(null); }
  }

  const issueFor = (asset: Asset) => issues.filter((issue) => { const src = issue.imageSrc?.split(/[?#]/)[0] ?? ''; if (!src) return false; const base = issue.file.includes('/') ? issue.file.slice(0, issue.file.lastIndexOf('/') + 1) : ''; const resolved = resolveArchivePath(base, src); return resolved === asset.path || src.split('/').pop() === asset.path.split('/').pop(); });
  const groups = useMemo(() => ['장식', '정보 (이미지 목차용)', '장', '기타', '미사용'].map((name) => ({ name, items: assets.filter((asset) => name === '미사용' ? !asset.used : asset.used && asset.category === name) })).filter((group) => group.items.length), [assets]);
  return <section className="image-assets-panel">
    <h3 className="image-assets-heading">EPUB 이미지 파일</h3>
    <p className="image-assets-note">EPUB에 포함된 이미지 파일을 파일명 기준으로 분류합니다. 미사용은 문서·스타일·목차 파일에서 참조되지 않는 파일입니다.</p>
    {loading ? <p className="report-loading">이미지 파일 확인 중...</p> : groups.length === 0 ? <p className="check-detail-success">이미지 파일이 없습니다.</p> : groups.map((group) => <section className="image-assets-group" key={group.name}><h3>{group.name}<span>{group.items.length}</span></h3>{group.items.map((asset) => { const assetIssues = issueFor(asset); return <div className={`image-assets-item ${assetIssues.length ? 'has-issue' : ''}`} key={asset.path}><div className="image-assets-row"><span title={asset.path}>{displayEpubPath(asset.path).split('/').pop()}</span><div><button type="button" className="compact-action" onClick={() => void showPreview(asset)}>보기</button><button type="button" className="compact-action image-delete-button" onClick={() => void remove(asset)} disabled={disabled || deleting === asset.path}>{deleting === asset.path ? '삭제 중' : '삭제'}</button></div></div>{assetIssues.length > 0 && <ul className="image-assets-issues">{assetIssues.flatMap((issue) => issue.reasons).map((reason, index) => <li key={`${asset.path}-${index}`}>{reason}</li>)}</ul>}</div>; })}</section>)}
    {preview && <div className="loi-image-modal-backdrop" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}><div className="loi-image-modal" onClick={(event) => event.stopPropagation()}><div className="loi-image-modal-header"><div><strong>{displayEpubPath(preview.path)}</strong></div><button type="button" className="loi-modal-close" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>×</button></div><div className="loi-image-modal-content"><img src={preview.url} alt={preview.path} /></div></div></div>}
  </section>;
}
