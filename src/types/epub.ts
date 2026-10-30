export interface EpubMetadata {
  title: string;
  creator: string;
}

export interface CountCheckResult {
  exists: boolean;
  count: number;
}

export interface TitleCheckResult {
  total: number;
  matched: number;
  unmatched: number;
  excluded: string[];
  unmatchedFiles: string[];
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
}

export interface LoiCheckResult {
  total: number;
  matched: number;
  unmatched: number;
  details: string[];
}

export interface EpubMetadataChecks {
  titleXhtml: TitleCheckResult;
  coverTitle: CountCheckResult;
  copyrightTitle: CountCheckResult;
  coverCreator: CountCheckResult;
  introduceCreator: CountCheckResult;
  copyrightCreator: CountCheckResult;
  conformsTo: boolean;
  accFix: boolean;
  language: FileCheckResult;
  chapter: FileCheckResult;
  loiItems: LoiCheckResult;
  loiImageDuplicates: LoiCheckResult;
  loiImageNumbers: LoiCheckResult;
}

export interface EpubAnalysisResult {
  metadata: EpubMetadata;
  checks: EpubMetadataChecks;
}
