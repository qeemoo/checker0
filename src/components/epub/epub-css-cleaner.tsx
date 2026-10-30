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
          <p className="mt-1 text-sm text-gray-600">
            사용하지 않는 색상 클래스는 제외하고, 색상 클래스명과 색상값을 통일해 위치·색상별로 정리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onCleanFiles(preview?.cssFiles ?? [])}
          disabled={disabled || !preview || preview.cssFiles.length === 0}
          className="btn-primary"
        >
          전체 CSS 정리하기
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
                        {isSelected ? "정리 예약됨" : "이 CSS 정리하기"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="css-preview-body">
                      {item.colors.length > 0 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {item.colors.map((color, index) => (
                            <span
                              key={`${color.className}-${color.property}-${index}`}
                              className="inline-flex items-center gap-2 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700"
                            >
                              <span
                                className="inline-block h-3 w-3 rounded-sm border border-gray-300"
                                style={
                                  color.property === "background-color"
                                    ? { backgroundColor: color.color }
                                    : { backgroundColor: "#FFFFFF" }
                                }
                              />
                              .{color.className} · {color.color} · {color.location}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mb-3 text-sm text-gray-500">정리할 색상 클래스가 없습니다.</p>
                      )}
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
