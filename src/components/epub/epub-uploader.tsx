"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";

import type { EpubAnalysisResult, EpubMetadata } from "../../types/epub";
import { analyzeEpub } from "../../lib/epub/analyze-epub";
import {
  previewEpubCss,
  cleanEpubCss,
  type CssCleanupPreview,
} from "../../lib/epub/clean-css";
import EpubMetadataSection from "./epub-metadata";
import EpubCheckResults from "./epub-check-results";
import EpubCssCleaner from "./epub-css-cleaner";

const CONTAINER_PATH = "META-INF/container.xml";
const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const ACCESSIBILITY_AA = "EPUB Accessibility 1.1 - WCAG 2.2 Level AA";

interface ModifiedEpubResult {
  blob: Blob;
  accessibilityModified: boolean;
}

export default function EpubUploader() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<EpubAnalysisResult | null>(null);
  const [metadata, setMetadata] = useState<EpubMetadata>({ title: "", creator: "" });
  const [originalMetadata, setOriginalMetadata] = useState<EpubMetadata>({
    title: "",
    creator: "",
  });
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [accessibilityModified, setAccessibilityModified] = useState(false);
  const [cssPreview, setCssPreview] = useState<CssCleanupPreview | null>(null);
  const [cssPreviewError, setCssPreviewError] = useState("");
  const [cleanedCssFiles, setCleanedCssFiles] = useState<string[]>([]);

  const hasMetadataChanges =
    metadata.title !== originalMetadata.title || metadata.creator !== originalMetadata.creator;
  const hasChanges = hasMetadataChanges || accessibilityModified || cleanedCssFiles.length > 0;

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".epub")) {
      setError("EPUB 파일만 업로드할 수 있습니다.");
      return;
    }

    setLoading(true);
    setError("");
    setCssPreviewError("");
    setCleanedCssFiles([]);

    try {
      const originalAnalysis = await analyzeEpub(file);
      const modifiedResult = await createModifiedEpub(file, originalAnalysis.metadata, []);
      const fileToAnalyze = new File([modifiedResult.blob], file.name, {
        type: "application/epub+zip",
        lastModified: Date.now(),
      });
      const finalAnalysis = modifiedResult.accessibilityModified
        ? await analyzeEpub(fileToAnalyze)
        : originalAnalysis;

      setOriginalFile(file);
      setAnalysis(finalAnalysis);
      setMetadata({ ...originalAnalysis.metadata });
      setOriginalMetadata({ ...originalAnalysis.metadata });
      setAccessibilityModified(modifiedResult.accessibilityModified);

      try {
        const zip = await JSZip.loadAsync(file);
        setCssPreview(await previewEpubCss(zip));
      } catch (previewError) {
        setCssPreview(null);
        setCssPreviewError(
          previewError instanceof Error
            ? previewError.message
            : "CSS 정리 미리보기를 생성하지 못했습니다.",
        );
      }
    } catch (err) {
      console.error("EPUB 분석 실패:", err);
      setError("EPUB 파일을 분석하거나 수정하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function updateMetadata(updatedMetadata: EpubMetadata) {
    if (!originalFile) return;

    setLoading(true);
    setError("");

    try {
      const modifiedResult = await createModifiedEpub(
        originalFile,
        updatedMetadata,
        cleanedCssFiles,
      );
      const modifiedFile = new File([modifiedResult.blob], originalFile.name, {
        type: "application/epub+zip",
        lastModified: Date.now(),
      });
      const updatedAnalysis = await analyzeEpub(modifiedFile);

      setMetadata(updatedMetadata);
      setAnalysis(updatedAnalysis);
      setAccessibilityModified(modifiedResult.accessibilityModified);
    } catch (err) {
      console.error("메타데이터 수정 실패:", err);
      setError("메타데이터 수정에 실패했습니다.");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function handleCleanCss(files: string[]) {
    setCleanedCssFiles((current) => [...new Set([...current, ...files])]);
  }

  async function downloadModifiedEpub() {
    if (!originalFile || !hasChanges || loading) return;

    setLoading(true);
    setError("");

    try {
      const modifiedResult = await createModifiedEpub(
        originalFile,
        metadata,
        cleanedCssFiles,
      );
      const originalName = originalFile.name.replace(/\.epub$/i, "");
      const downloadName = `${originalName}(수정).epub`;
      const url = URL.createObjectURL(modifiedResult.blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("EPUB 다운로드 실패:", err);
      setError("수정된 EPUB 파일을 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setOriginalFile(null);
    setAnalysis(null);
    setMetadata({ title: "", creator: "" });
    setOriginalMetadata({ title: "", creator: "" });
    setAccessibilityModified(false);
    setCssPreview(null);
    setCssPreviewError("");
    setCleanedCssFiles([]);
    setDragging(false);
    setError("");
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-title">EPUB Checker</h1>
      </header>

      {!originalFile && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`upload-dropzone ${dragging ? "is-dragging" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".epub"
            onChange={handleInputChange}
            className="hidden"
          />
          <span className="upload-icon" aria-hidden="true">↑</span>
          <p className="upload-title">EPUB 파일을 선택하거나 여기에 끌어다 놓으세요.</p>
          <p className="upload-hint">EPUB 파일만 업로드할 수 있습니다 · 클릭하여 파일 선택</p>
        </div>
      )}

      {loading && (
        <p className="loading-message">EPUB 파일을 처리하고 있습니다...</p>
      )}

      {error && (
        <p className="error-message">
          {error}
        </p>
      )}

      {analysis && originalFile && (
        <>
          <div className="action-toolbar">
            <button
              type="button"
              onClick={downloadModifiedEpub}
              disabled={!hasChanges || loading}
              className="btn-primary"
            >
              다운로드
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={loading}
              className="btn-secondary"
            >
              초기화
            </button>
          </div>

          <EpubMetadataSection metadata={metadata} onSave={updateMetadata} />
          <EpubCheckResults
            checks={analysis.checks}
            accessibilityModified={accessibilityModified}
          />
          <EpubCssCleaner
            preview={cssPreview}
            selectedFiles={cleanedCssFiles}
            onCleanFiles={handleCleanCss}
            disabled={loading}
            error={cssPreviewError}
          />
        </>
      )}
    </main>
  );
}

async function createModifiedEpub(
  originalFile: File,
  metadata: EpubMetadata,
  cssFilesToClean: string[],
): Promise<ModifiedEpubResult> {
  const zip = await JSZip.loadAsync(originalFile);
  const containerFile = zip.file(CONTAINER_PATH);

  if (!containerFile) {
    throw new Error("META-INF/container.xml 파일을 찾을 수 없습니다.");
  }

  const containerText = await containerFile.async("string");
  const containerDocument = new DOMParser().parseFromString(containerText, "application/xml");

  if (containerDocument.querySelector("parsererror")) {
    throw new Error("container.xml 파일을 읽을 수 없습니다.");
  }

  const rootfile = containerDocument.getElementsByTagNameNS(
    "urn:oasis:names:tc:opendocument:xmlns:container",
    "rootfile",
  )[0];
  const opfPath = rootfile?.getAttribute("full-path");

  if (!opfPath) throw new Error("OPF 파일 경로를 찾을 수 없습니다.");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("OPF 파일을 찾을 수 없습니다.");

  const opfText = await opfFile.async("string");
  const opfDocument = new DOMParser().parseFromString(opfText, "application/xml");

  if (opfDocument.querySelector("parsererror")) {
    throw new Error("OPF XML을 읽을 수 없습니다.");
  }

  const metadataElement = opfDocument.getElementsByTagNameNS(OPF_NS, "metadata")[0];
  if (!metadataElement) throw new Error("OPF metadata 요소를 찾을 수 없습니다.");

  updateDcElement(metadataElement, "title", metadata.title);
  updateDcElement(metadataElement, "creator", metadata.creator);
  const accessibilityModified = updateAccessibilityLevel(metadataElement);

  zip.file(opfPath, new XMLSerializer().serializeToString(opfDocument));

  if (cssFilesToClean.length > 0) {
    await cleanEpubCss(zip, cssFilesToClean);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  });

  return { blob, accessibilityModified };
}

function updateAccessibilityLevel(metadataElement: Element): boolean {
  const conformElements = Array.from(metadataElement.getElementsByTagName("meta")).filter(
    (element) => element.getAttribute("property") === "dcterms:conformsTo",
  );

  if (conformElements.length === 0) return false;

  let modified = false;
  conformElements.forEach((element) => {
    const value = element.textContent?.trim() ?? "";
    if (
      value === "EPUB Accessibility 1.1 - WCAG 2.2 Level A" ||
      value === "EPUB Accessibility 1.1 - WCAG 2.2 Level AAA"
    ) {
      element.textContent = ACCESSIBILITY_AA;
      modified = true;
    }
  });

  return modified;
}

function updateDcElement(
  metadataElement: Element,
  tagName: "title" | "creator",
  value: string,
) {
  let element = metadataElement.getElementsByTagNameNS(DC_NS, tagName)[0];

  if (!element) {
    element = metadataElement.ownerDocument.createElementNS(DC_NS, `dc:${tagName}`);
    metadataElement.appendChild(element);
  }

  element.textContent = value;
}
