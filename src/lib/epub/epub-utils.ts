export function getFileName(path: string): string {
  return path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function resolveRelativePath(fromFile: string, href: string): string {
  const base = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const joined = href.startsWith("/") ? href.slice(1) : `${base ? `${base}/` : ""}${href}`;
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
