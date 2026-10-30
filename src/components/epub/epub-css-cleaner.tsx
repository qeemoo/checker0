"use client";

import { useState } from "react";
import type { CssCleanupPreview } from "../../lib/epub/clean-css";

interface EpubCssCleanerProps {
  preview: CssCleanupPreview | null;
  selectedFiles: string[];
  onCleanFiles: (files: string[]) => void;
  disabled?: boolean;
  error?: string;
}

export default function EpubCssCleaner({
  preview,
  selectedFiles,
  onCleanFiles,
  disabled = false,
  error = "",
}: EpubCssCleanerProps) {
  const [openFiles, setOpenFiles] = useState<string[]>([]);

  function togglePreview(path: string) {
    setOpenFiles((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  if (!preview && !error) return null;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-black">CSS 정리</h2>
        </div>
        <button
          type="button"
          onClick={() => onCleanFiles(preview?.cssFiles ?? [])}
          disabled={disabled || !preview || preview.cssFiles.length === 0}
          className="btn-primary"
        >
          전체 정리
        </button>
      </div>

      {error && (
        <p className="mt-4 error-message">
          {error}
        </p>
      )}

      {preview && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="CSS 파일" value={preview.cssFiles.length} />
            <Summary label="XHTML 파일" value={preview.xhtmlFiles.length} />
            <Summary label="색상 클래스" value={preview.colors.length} />
            <Summary label="클래스명 변경" value={preview.renamedClasses} />
          </div>

          <div className="mt-5 space-y-3">
            {preview.previewsByFile.map((item) => {
              const isSelected = selectedFiles.includes(item.path);
              const isOpen = openFiles.includes(item.path);

              return (
                <div key={item.path} className="css-preview-card">
                  <div className="css-preview-head flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-semibold text-black">{item.path}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        색상 클래스 {item.colors.length}개 · 클래스명 변경 {item.renamedClasses}개
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => togglePreview(item.path)}
                        className="btn-secondary"
                      >
                        {isOpen ? "미리보기 닫기" : "미리보기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onCleanFiles([item.path])}
                        disabled={disabled}
                        className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                          isSelected
                            ? "btn-soft"
                            : "btn-primary"
                        }`}
                      >
                        {isSelected ? "정리 예약됨" : "정리"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="css-preview-body">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold tracking-wide text-gray-500">색상 규칙 미리보기</p>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          {item.colors.length}개 규칙
                        </span>
                      </div>
                      <pre className="css-code-preview">
                        {item.previewCss || "표시할 색상 규칙이 없습니다."}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedFiles.length > 0 && (
            <p className="mt-4 text-sm font-medium text-green-700">
              {selectedFiles.length}개 CSS 파일의 정리가 다운로드 파일에 반영됩니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-tile">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-black">{value}</p>
    </div>
  );
}
