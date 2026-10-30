import JSZip from "jszip";

export interface ParsedXhtmlFile {
  path: string;
  document: Document;
}

export interface ParsedEpub {
  zip: JSZip;
  opfPath: string;
  opfDocument: Document;
  metadataElement: Element;
  xhtmlFiles: ParsedXhtmlFile[];
}

const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const OPF_NS = "http://www.idpf.org/2007/opf";

function resolveZipPath(basePath: string, relativePath: string): string {
  const joined = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : `${basePath ? `${basePath}/` : ""}${relativePath}`;
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export async function parseEpub(file: File): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("META-INF/container.xml 파일을 찾을 수 없습니다.");

  const containerText = await containerFile.async("text");
  const containerDocument = new DOMParser().parseFromString(containerText, "application/xml");
  if (containerDocument.querySelector("parsererror")) throw new Error("container.xml 형식이 올바르지 않습니다.");

  const rootfile = containerDocument.getElementsByTagNameNS(CONTAINER_NS, "rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("OPF 파일 경로를 찾을 수 없습니다.");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`OPF 파일을 찾을 수 없습니다: ${opfPath}`);
  const opfText = await opfFile.async("text");
  const opfDocument = new DOMParser().parseFromString(opfText, "application/xml");
  if (opfDocument.querySelector("parsererror")) throw new Error("OPF XML 형식이 올바르지 않습니다.");

  const metadataElement = opfDocument.getElementsByTagNameNS(OPF_NS, "metadata")[0];
  const manifest = opfDocument.getElementsByTagNameNS(OPF_NS, "manifest")[0];
  if (!metadataElement || !manifest) throw new Error("OPF의 metadata 또는 manifest 요소를 찾을 수 없습니다.");

  const opfDirectory = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const xhtmlFiles: ParsedXhtmlFile[] = [];
  const items = Array.from(manifest.getElementsByTagNameNS(OPF_NS, "item"));

  for (const item of items) {
    const mediaType = item.getAttribute("media-type") ?? "";
    const href = item.getAttribute("href") ?? "";
    if (mediaType !== "application/xhtml+xml" || !href) continue;
    const path = resolveZipPath(opfDirectory, href.split("#")[0]);
    const entry = zip.file(path);
    if (!entry) continue;
    const text = await entry.async("text");
    const document = new DOMParser().parseFromString(text, "application/xhtml+xml");
    if (document.querySelector("parsererror")) continue;
    xhtmlFiles.push({ path, document });
  }

  return { zip, opfPath, opfDocument, metadataElement, xhtmlFiles };
}
