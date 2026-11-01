export interface EpubMetadata {
  title: string;
  creator: string;
}

export interface MetadataTextDetail {
  file: string;
  targetType: 'text' | 'alt' | 'author-name' | 'copy-title' | 'copy-author' | 'copyright-symbol-text' | 'copyright-symbol-paragraph';
  partIndex?: number;
  targetIndex: number;
  status?: 'match' | 'mismatch' | 'suspect';
  currentText: string;
  preview: string;
  matched: boolean;
}

export interface CountCheckResult {
  exists: boolean;
  count: number;
  details?: MetadataTextDetail[];
}

export interface TitleCheckResult {
  total: number;
  matched: number;
  unmatched: number;
  excluded: string[];
  unmatchedFiles: string[];
  details: { file: string; title: string; matched: boolean }[];
}

export interface ChapterFailureDetail {
  file: string;
  sectionIndex: number;
  epubType: string | null;
  role: string | null;
  reasons: string[];
  html: string;
}

export interface FileCheckResult {
  total: number;
  matched: number;
  unmatched: number;
  unmatchedFiles: string[];
  unmatchedDetails?: ChapterFailureDetail[];
  fileValues?: { file: string; lang: string | null; xmlLang: string | null }[];
}

export interface LoiCheckResult {
  total: number;
  matched: number;
  unmatched: number;
  details: string[];
}

export interface LoiFigurePreview {
  xhtmlFile: string;
  file: string;
  caption: string;
  imageDataUrl: string;
  imagePaths: string[];
  id: string;
  hasIssue?: boolean;
}

export interface SectionTypeFix {
  file: string;
  sectionIndex: number;
  sectionType: 'preface' | 'chapter';
  newFileName?: string;
}

export interface TocContentEntry {
  index: number;
  text: string;
  href?: string;
  targetHref?: string;
  className?: string;
  tagName?: string;
  parentPartText?: string;
  previousText?: string;
  nextText?: string;
  previousHref?: string;
  nextHref?: string;
}

export interface TocContentIssue {
  id: string;
  kind: "text" | "missing-in-toc" | "missing-in-content";
  toc: TocContentEntry | null;
  content: TocContentEntry | null;
  canAddToToc: boolean;
  canAddToContent: boolean;
}

export interface TocContentCheckResult {
  total: number;
  matched: number;
  unmatched: number;
  issues: TocContentIssue[];
  tocEntries: TocContentEntry[];
  contentEntries: TocContentEntry[];
  error?: string;
}

export interface TocContentFix {
  targetSide: "toc" | "content";
  action: "update" | "add" | "delete";
  tocHref?: string;
  tocOriginalText?: string;
  contentOriginalText?: string;
  contentClassName?: string;
  contentTagName?: string;
  contentIndex?: number;
  replacementText: string;
  targetHref?: string;
  parentPartText?: string;
  previousText?: string;
  nextText?: string;
  previousHref?: string;
  nextHref?: string;
}

export type CodeIssueFixType = "dialogue" | "aside" | "image" | "footnote";

export interface CodeIssueDetail {
  file: string;
  element: string;
  reasons: string[];
  html: string;
  fixType: CodeIssueFixType;
  targetIndex: number;
  asideRole?: "none" | "doc-tip";
  imageSrc?: string;
}

export interface CodeCheckItemResult {
  total: number;
  matched: number;
  unmatched: number;
  details: CodeIssueDetail[];
}

export interface EpubCodeChecks {
  dialogue: CodeCheckItemResult;
  asideRole: CodeCheckItemResult;
  imageRole: CodeCheckItemResult;
  footnote: CodeCheckItemResult;
}

export interface EpubMetadataChecks {
  titleXhtml: TitleCheckResult;
  coverTitle: CountCheckResult;
  copyrightTitle: CountCheckResult;
  coverCreator: CountCheckResult;
  introduceCreator: CountCheckResult;
  copyrightCreator: CountCheckResult;
  copyrightSymbol: CountCheckResult;
  conformsTo: boolean;
  conformsToValue: string | null;
  accFix: boolean;
  accFixTags: string[];
  language: FileCheckResult;
  chapter: FileCheckResult;
  loiItems: LoiCheckResult;
  loiFigcapMissing: LoiCheckResult;
  loiTocMissing: LoiCheckResult;
  loiImageDuplicates: LoiCheckResult;
  loiImageNumbers: LoiCheckResult;
  loiFigurePreviews: LoiFigurePreview[];
  epubFilePaths: string[];
  tocContent: TocContentCheckResult;
  code: EpubCodeChecks;
}

export interface EpubAnalysisResult {
  metadata: EpubMetadata;
  checks: EpubMetadataChecks;
}
