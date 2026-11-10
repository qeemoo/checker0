import JSZip from "jszip";

export interface CssColorItem {
  className: string;
  color: string;
  property: "color" | "background-color";
  location: string;
  category: string;
  selector: string;
  cssFile: string;
}

export interface CssFilePreview {
  path: string;
  previewCss: string;
  colors: CssColorItem[];
  classRenames: { from: string; to: string }[];
  renamedClasses: number;
  updatedColorValues: number;
}

export interface CssCleanupPreview {
  cssFiles: string[];
  xhtmlFiles: string[];
  colors: CssColorItem[];
  previewCss: string;
  previewsByFile: CssFilePreview[];
  renamedClasses: number;
  updatedColorValues: number;
}

export interface CssCleanupResult extends CssCleanupPreview {
  changed: boolean;
  changedCssFiles: string[];
  changedXhtmlFiles: string[];
}

const COLOR_SECTION_TITLE = "색상 적용";
const SPACING_SECTION_TITLE = "여백 단락 간격";
const COLOR_CLASS_PATTERN = /^[CBF][0-9a-f]{6}$/i;

function normalizeClassName(className: string): string {
  if (!COLOR_CLASS_PATTERN.test(className)) return className;

  const hex = className.slice(1).toUpperCase();

  if (className[0].toUpperCase() === "B") return `B${hex}`;
  return hex === "FFFFFF" ? "CFFFFFF" : `F${hex}`;
}

function normalizeLocation(filePath: string): string {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";

  if (name === "content.xhtml") return "Content";
  if (/^part(?:[-_0-9.]|$)/.test(name)) return "Part";
  if (/^chapter(?:[-_0-9.]|$)/.test(name)) return "Chapter";
  if (/^preface(?:[-_0-9.]|$)/.test(name)) return "Preface";
  return "공통";
}

function getColorCategory(color: string): string {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "";

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (max < 0.12) return "검정";
  if (min > 0.88) return "흰색";
  if (delta < 0.12) return "회색";

  let hue = 0;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;

  if (hue < 15 || hue >= 345) return "빨강";
  if (hue < 45) return "주황";
  if (hue < 70) return "노랑";
  if (hue < 165) return "초록";
  if (hue < 255) return "파랑";
  if (hue < 300) return "보라";
  return "빨강";
}

function protectCssCommentsAndStrings(css: string): {
  content: string;
  restore: (value: string) => string;
} {
  const protectedParts: string[] = [];
  const content = css.replace(
    /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (part) => {
      const index = protectedParts.push(part) - 1;
      return `__EPUB_CSS_PROTECTED_${index}__`;
    },
  );

  return {
    content,
    restore: (value: string) =>
      value.replace(/__EPUB_CSS_PROTECTED_(\d+)__/g, (_match, index: string) => {
        return protectedParts[Number(index)] ?? "";
      }),
  };
}

function colorClassName(property: "color" | "background-color", color: string): string {
  const hex = color.replace("#", "").toUpperCase();
  if (property === "background-color") return `B${hex}`;
  return hex === "FFFFFF" ? "CFFFFFF" : `F${hex}`;
}

async function buildColorClassMap(zip: JSZip): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir || !path.toLowerCase().endsWith(".css")) continue;
    const entry = zip.file(path);
    if (!entry) continue;
    const css = await entry.async("text");
    const rules = /([^{}]+)\{([^{}]*)\}/g;
    let rule: RegExpExecArray | null;
    while ((rule = rules.exec(css)) !== null) {
      const classes: string[] = [];
      const classPattern = /\.([CBF][0-9a-f]{6})(?![\w-])/gi;
      let classMatch: RegExpExecArray | null;
      while ((classMatch = classPattern.exec(rule[1])) !== null) classes.push(classMatch[1]);
      const declarations = rule[2];
      const colors: { property: string; value: string }[] = [];
      const colorPattern = /\b(color|background-color)\s*:\s*(#[0-9a-f]{6})\b/gi;
      let colorMatch: RegExpExecArray | null;
      while ((colorMatch = colorPattern.exec(declarations)) !== null) colors.push({ property: colorMatch[1], value: colorMatch[2] });
      for (const color of colors) {
        const property = color.property.toLowerCase() as "color" | "background-color";
        const replacement = colorClassName(property, color.value);
        for (const original of classes) {
          const oldName = normalizeClassName(original);
          if (property === "background-color" && oldName[0].toUpperCase() !== "B") continue;
          if (property === "color" && oldName[0].toUpperCase() === "B") continue;
          mapping.set(oldName, replacement);
        }
      }
    }
  }
  return mapping;
}

function normalizeCss(css: string, classMap: Map<string, string> = new Map()): {
  content: string;
  renamedClasses: number;
  updatedColorValues: number;
} {
  let renamedClasses = 0;
  let updatedColorValues = 0;
  const protectedCss = protectCssCommentsAndStrings(css);

  let content = protectedCss.content.replace(
    /\.([CBF][0-9a-f]{6})(?![\w-])/gi,
    (match, className: string) => {
      const baseName = normalizeClassName(className);
      const normalized = classMap.get(baseName) ?? baseName;
      if (normalized !== className) renamedClasses += 1;
      return `.${normalized}`;
    },
  );

  content = content.replace(/#([0-9a-f]{6})(?![0-9a-f])/gi, (match, hex: string) => {
    const normalized = `#${hex.toUpperCase()}`;
    if (match !== normalized) updatedColorValues += 1;
    return normalized;
  });

  return {
    content: protectedCss.restore(content),
    renamedClasses,
    updatedColorValues,
  };
}

async function collectClassLocations(zip: JSZip, classMap: Map<string, string> = new Map()): Promise<Map<string, Set<string>>> {
  const locations = new Map<string, Set<string>>();

  for (const path of Object.keys(zip.files)) {
    if (!path.toLowerCase().endsWith(".xhtml")) continue;
    const file = zip.file(path);
    if (!file) continue;

    const xhtml = await file.async("text");
    const classPattern = /\bclass\s*=\s*(["'])([\s\S]*?)\1/g;
    let match: RegExpExecArray | null;

    while ((match = classPattern.exec(xhtml)) !== null) {
      for (const originalName of match[2].split(/\s+/).filter(Boolean)) {
        if (!COLOR_CLASS_PATTERN.test(originalName)) continue;

        const baseName = normalizeClassName(originalName);
        const normalizedName = classMap.get(baseName) ?? baseName;
        if (!locations.has(normalizedName)) locations.set(normalizedName, new Set());
        locations.get(normalizedName)!.add(normalizeLocation(path));
      }
    }
  }

  return locations;
}

function buildColorCss(items: CssColorItem[]): string {
  const locationOrder = ["공통", "Part", "Chapter", "Preface", "Content"];
  const categoryOrder = ["빨강", "주황", "노랑", "초록", "파랑", "보라", "회색", "흰색", "검정", ""];

  const sortedItems = [...items].sort((a, b) => {
    const locationA = locationOrder.indexOf(a.location);
    const locationB = locationOrder.indexOf(b.location);
    const locationDiff = (locationA < 0 ? 0 : locationA) - (locationB < 0 ? 0 : locationB);
    if (locationDiff !== 0) return locationDiff;

    // 폰트 색상(CFFFFFF 우선, 그 다음 F 계열)을 배경색(B 계열)보다 먼저 배치합니다.
    const priority = (item: CssColorItem) =>
      item.className === "CFFFFFF" ? 0 : item.property === "color" ? 1 : 2;
    const priorityDiff = priority(a) - priority(b);
    if (priorityDiff !== 0) return priorityDiff;

    const categoryA = categoryOrder.indexOf(a.category);
    const categoryB = categoryOrder.indexOf(b.category);
    const categoryDiff = (categoryA < 0 ? categoryOrder.length : categoryA) -
      (categoryB < 0 ? categoryOrder.length : categoryB);
    if (categoryDiff !== 0) return categoryDiff;
    return a.className.localeCompare(b.className);
  });

  const rows = sortedItems.map((item) => {
    const declaration = item.property === "color" ? "color" : "background-color";
    const code = `.${item.className} { ${declaration}: ${item.color.toUpperCase()}; }`;
    const comment = item.category
      ? `/* ${item.location || "공통"} - ${item.category} */`
      : "/* 공통 - */";
    return { code, comment };
  });

  const commentColumn = rows.reduce((max, row) => Math.max(max, row.code.length), 0) + 2;
  return rows.map(({ code, comment }) => `${code.padEnd(commentColumn)}${comment}`).join("\n");
}

function replaceColorSection(css: string, colorCss: string): string {
  const colorTitleIndex = css.indexOf(COLOR_SECTION_TITLE);
  const spacingTitleIndex = css.indexOf(SPACING_SECTION_TITLE);

  if (colorTitleIndex < 0 || spacingTitleIndex < 0 || spacingTitleIndex <= colorTitleIndex) {
    throw new Error(
      `CSS에서 "${COLOR_SECTION_TITLE}" 및 "${SPACING_SECTION_TITLE}" 구역을 찾을 수 없습니다.`,
    );
  }

  const startIndex = css.lastIndexOf("/*", colorTitleIndex);
  const endIndex = css.lastIndexOf("/*", spacingTitleIndex);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error("CSS 색상 구역의 주석 경계를 확인할 수 없습니다.");
  }

  const headerEnd = css.indexOf("*/", startIndex);
  if (headerEnd < 0 || headerEnd >= endIndex) {
    throw new Error("CSS 색상 구역의 제목 주석이 올바르지 않습니다.");
  }

  const header = css.slice(startIndex, headerEnd + 2);
  return `${css.slice(0, startIndex)}${header}\n${colorCss}\n\n${css.slice(endIndex)}`;
}

function findColorRules(
  css: string,
  cssFile: string,
  classLocations: Map<string, Set<string>>,
): CssColorItem[] {
  const items: CssColorItem[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(css)) !== null) {
    const selector = match[1].trim();
    const declarations = match[2];
    const classMatches: RegExpExecArray[] = [];
    const classPattern = /\.([CBF][0-9a-f]{6})(?![\w-])/gi;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classPattern.exec(selector)) !== null) {
      classMatches.push(classMatch);
    }
    if (!classMatches.length) continue;

    const declarationPattern = /\b(color|background-color)\s*:\s*(#[0-9a-f]{6})\b/gi;
    let declarationMatch: RegExpExecArray | null;

    while ((declarationMatch = declarationPattern.exec(declarations)) !== null) {
      const property = declarationMatch[1].toLowerCase() as "color" | "background-color";
      const color = declarationMatch[2].toUpperCase();

      for (const classMatch of classMatches) {
        const className = normalizeClassName(classMatch[1]);
        const usedLocations = classLocations.get(className);

        // XHTML에서 실제로 사용되지 않는 색상 클래스는 정리 결과에서 제외합니다.
        if (!usedLocations || usedLocations.size === 0) continue;

        const locations = [...usedLocations];
        const location = locations.length > 1 ? "공통" : locations[0] ?? "공통";

        items.push({
          className:
            property === "background-color"
              ? `B${className.slice(1).toUpperCase()}`
              : className.slice(1).toUpperCase() === "FFFFFF"
                ? "CFFFFFF"
                : `F${className.slice(1).toUpperCase()}`,
          color,
          property,
          location,
          category: getColorCategory(color),
          selector,
          cssFile,
        });
      }
    }
  }

  const unique = new Map<string, CssColorItem>();
  for (const item of items) {
    const key = `${item.className}|${item.property}|${item.color}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

async function normalizeXhtml(zip: JSZip, path: string, classMap: Map<string, string>): Promise<boolean> {
  const file = zip.file(path);
  if (!file) return false;

  const original = await file.async("text");
  const updated = original.replace(
    /\bclass\s*=\s*(["'])([\s\S]*?)\1/g,
    (_full, quote: string, classNames: string) => {
      const normalized = classNames
        .split(/(\s+)/)
        .map((token) => {
          if (/^\s+$/.test(token)) return token;
          const baseName = normalizeClassName(token);
          return classMap.get(baseName) ?? baseName;
        })
        .join("");
      return `class=${quote}${normalized}${quote}`;
    },
  );

  if (original === updated) return false;
  zip.file(path, updated);
  return true;
}

export async function previewEpubCss(zip: JSZip): Promise<CssCleanupPreview> {
  const cssFiles = Object.keys(zip.files).filter(
    (path) => !zip.files[path].dir && path.toLowerCase().endsWith(".css"),
  );
  if (!cssFiles.length) throw new Error("EPUB에서 CSS 파일을 찾을 수 없습니다.");

  const xhtmlFiles = Object.keys(zip.files).filter(
    (path) => !zip.files[path].dir && path.toLowerCase().endsWith(".xhtml"),
  );
  const classMap = await buildColorClassMap(zip);
  const classLocations = await collectClassLocations(zip, classMap);
  const previewsByFile: CssFilePreview[] = [];
  const allColors: CssColorItem[] = [];
  let renamedClasses = 0;
  let updatedColorValues = 0;

  for (const path of cssFiles) {
    const file = zip.file(path);
    if (!file) continue;

    const original = await file.async("text");
    const normalized = normalizeCss(original, classMap);
    const colors = findColorRules(normalized.content, path, classLocations);
    const colorPreview = buildColorCss(colors);
    const previewCss = colorPreview;

    previewsByFile.push({
      path,
      previewCss,
      colors,
      classRenames: [...classMap.entries()].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to })),
      renamedClasses: normalized.renamedClasses,
      updatedColorValues: normalized.updatedColorValues,
    });
    allColors.push(...colors);
    renamedClasses += normalized.renamedClasses;
    updatedColorValues += normalized.updatedColorValues;
  }

  return {
    cssFiles,
    xhtmlFiles,
    colors: allColors,
    previewCss: previewsByFile.map((item) => item.previewCss).filter(Boolean).join("\n\n"),
    previewsByFile,
    renamedClasses,
    updatedColorValues,
  };
}

export async function cleanEpubCss(
  zip: JSZip,
  targetCssFiles?: string[],
): Promise<CssCleanupResult> {
  const classMap = await buildColorClassMap(zip);
  const preview = await previewEpubCss(zip);
  const targets = new Set(targetCssFiles?.length ? targetCssFiles : preview.cssFiles);
  const changedCssFiles: string[] = [];
  const changedXhtmlFiles: string[] = [];

  // CSS 클래스명과 XHTML 클래스명은 동일한 규칙으로 정규화합니다.
  for (const path of preview.cssFiles) {
    const file = zip.file(path);
    if (!file) continue;

    const original = await file.async("text");
    const normalized = normalizeCss(original, classMap);
    const targetPreview = preview.previewsByFile.find((item) => item.path === path);

    let updated = normalized.content;
    if (targets.has(path) && targetPreview) {
      updated = replaceColorSection(normalized.content, targetPreview.previewCss);
    }

    if (original !== updated) {
      zip.file(path, updated);
      changedCssFiles.push(path);
    }
  }

  // CSS 파일 하나를 정리하더라도 클래스명 표기 규칙은 EPUB 전체에서 일치시킵니다.
  for (const path of preview.xhtmlFiles) {
    if (await normalizeXhtml(zip, path, classMap)) changedXhtmlFiles.push(path);
  }

  return {
    ...preview,
    changed: changedCssFiles.length > 0 || changedXhtmlFiles.length > 0,
    changedCssFiles,
    changedXhtmlFiles,
  };
}


/**
 * 서식 전용 CSS 정리. 선언·선택자·주석·문자열을 수정하지 않습니다.
 * 해석이 불확실한 파일은 원본 그대로 보존합니다.
 */
export async function formatEpubCssIndentation(zip: JSZip, paths: string[]): Promise<void> {
  for (const path of paths) {
    const entry = zip.file(path);
    if (!entry || !/\.css$/i.test(path)) continue;
    const original = await entry.async('text');
    // 주석, 문자열, CSS escape, 괄호 안의 구분자 등은 보수적으로 건너뜁니다.
    if (/\/\*|["'\\\\]/.test(original)) continue;
    let depth = 0;
    let parens = 0;
    let brackets = 0;
    let invalid = false;
    let output = '';
    let segment = '';
    const indent = () => '  '.repeat(depth);
    const emit = (value: string) => { output += indent() + value.trim() + '\n'; };
    for (const ch of original) {
      if (ch === '(') parens++;
      if (ch === ')') parens--;
      if (ch === '[') brackets++;
      if (ch === ']') brackets--;
      if (parens < 0 || brackets < 0) { invalid = true; break; }
      if (parens === 0 && brackets === 0 && ch === '{') {
        const selector = segment.trim();
        if (!selector) { invalid = true; break; }
        emit(selector + ' {');
        segment = '';
        depth++;
      } else if (parens === 0 && brackets === 0 && ch === ';') {
        if (segment.trim()) emit(segment.trim() + ';');
        else emit(';');
        segment = '';
      } else if (parens === 0 && brackets === 0 && ch === '}') {
        if (depth === 0) { invalid = true; break; }
        if (segment.trim()) emit(segment.trim());
        segment = '';
        depth--;
        emit('}');
        if (depth === 0) output += '\n';
      } else {
        segment += ch;
      }
    }
    if (invalid || depth !== 0 || parens !== 0 || brackets !== 0) continue;
    if (segment.trim()) output += segment.trim() + '\n';
    // 공백을 제외한 모든 원본 문자가 같은 순서로 유지되어야 적용합니다.
    if (output.replace(/\s/g, '') !== original.replace(/\s/g, '')) continue;
    if (output !== original) zip.file(path, output.trimEnd() + '\n');
  }
}
