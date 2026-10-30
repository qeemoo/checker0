"use client";

interface Props { onFile: (file: File) => void; disabled?: boolean }
export default function EpubDropzone({ onFile, disabled = false }: Props) {
  return <label className="block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center hover:border-gray-500">
    <input className="hidden" type="file" accept=".epub,application/epub+zip" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} />
    <span className="text-lg font-semibold">EPUB 파일을 선택하거나 여기에 끌어다 놓으세요.</span>
    <span className="mt-2 block text-sm text-gray-500">EPUB 파일만 업로드할 수 있습니다.</span>
  </label>;
}
