import type { EpubMetadataChecks, CountCheckResult, FileCheckResult, LoiCheckResult, TitleCheckResult } from "../../types/epub";

interface Props { checks: EpubMetadataChecks; accessibilityModified: boolean }

function Status({ ok, modified = false }: { ok: boolean; modified?: boolean }) {
  return <span className={`text-sm font-semibold ${ok ? "status-success" : "status-failure"}`}>{ok ? "통과" : "실패"}{modified ? " · 수정됨" : ""}</span>;
}
function CountRow({ label, value, modified = false }: { label: string; value: CountCheckResult; modified?: boolean }) {
  return <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-3"><span className="text-sm">{label} <span className="text-gray-500">({value.count}건)</span></span><Status ok={value.exists} modified={modified} /></div>;
}
function FileRow({ label, value }: { label: string; value: FileCheckResult | TitleCheckResult }) {
  const ok = value.unmatched === 0;
  return <details className="border-b border-gray-100 py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm"><span>{label} <span className="text-gray-500">({value.matched}/{value.total})</span></span><Status ok={ok} /></summary>
    {value.unmatchedFiles.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-600">{value.unmatchedFiles.map((file) => <li key={file}>{file}</li>)}</ul>}
    {"unmatchedDetails" in value && value.unmatchedDetails?.map((detail, index) => <div key={`${detail.file}-${detail.sectionIndex}-${index}`} className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700"><p>{detail.file} · section {detail.sectionIndex}</p><p>{detail.reasons.join(" / ")}</p><pre className="mt-1 overflow-auto whitespace-pre-wrap">{detail.html}</pre></div>)}
  </details>;
}
function LoiRow({ label, value }: { label: string; value: LoiCheckResult }) {
  const ok = value.unmatched === 0;
  return <details className="border-b border-gray-100 py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm"><span>{label} <span className="text-gray-500">({value.matched}/{value.total})</span></span><Status ok={ok} /></summary>{value.details.length > 0 && <div className="mt-3 space-y-2">{value.details.map((item, index) => <pre key={`${index}-${item}`} className="whitespace-pre-wrap break-words rounded-lg border border-red-100 bg-red-50/70 px-3 py-2.5 font-sans text-xs leading-6 text-red-700">{item}</pre>)}</div>}</details>;
}

export default function EpubCheckResults({ checks, accessibilityModified }: Props) {
  return <section className="panel">
    <h2 className="mb-3 text-xl font-bold">검사 결과</h2>
    <div className="mb-4 flex items-center justify-between border-b border-gray-100 py-3 text-sm"><span>접근성 적합성(WCAG 2.2 AA)</span><Status ok={checks.conformsTo} modified={accessibilityModified} /></div>
    <div className="flex items-center justify-between border-b border-gray-100 py-3 text-sm"><span>ACC-fix 메타데이터 미포함</span><Status ok={checks.accFix} /></div>
    <h3 className="mb-1 mt-5 font-semibold">메타데이터 검사</h3>
    <CountRow label="표지 이미지 대체 텍스트 - 제목·저자" value={checks.coverTitle} />
    <CountRow label="표지 이미지 대체 텍스트 - 저자" value={checks.coverCreator} />
    <CountRow label="저작권 페이지 - 제목" value={checks.copyrightTitle} />
    <CountRow label="저작권 페이지 - 저자" value={checks.copyrightCreator} />
    <CountRow label="소개 페이지 - 저자" value={checks.introduceCreator} />
    <FileRow label="XHTML title과 도서 제목 일치" value={checks.titleXhtml} />
    <h3 className="mb-1 mt-5 font-semibold">문서 구조 및 언어</h3>
    <FileRow label="한국어 lang / xml:lang" value={checks.language} />
    <FileRow label="Chapter section 구조" value={checks.chapter} />
    <h3 className="mb-1 mt-5 font-semibold">목차(LOI) 검사</h3>
    <LoiRow label="그림 캡션과 LOI 링크 일치" value={checks.loiItems} />
    <LoiRow label="동일 이미지 중복 사용" value={checks.loiImageDuplicates} />
    <LoiRow label="동일 이미지의 Figure ID 일치" value={checks.loiImageNumbers} />
  </section>;
}
