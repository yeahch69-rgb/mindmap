export type TranslationLang = 'ko' | 'ja' | 'en';
export type TranslationFormat = 'text' | 'html';

export type TranslationErrorCode =
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_PROVIDER';

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly statusCode: number;

  constructor(code: TranslationErrorCode, message: string, statusCode = 503) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface TranslationSegmentResult {
  translatedTexts: string[];
  detectedSourceLang: string | null;
}

/**
 * Provider adapter interface.
 * Swap `TRANSLATION_PROVIDER` env var to switch between free unofficial Google Translate
 * and future AI/commercial providers (Gemini, OpenAI, Google Cloud Translation v2/v3, DeepL)
 * without changing API contracts or frontend code.
 */
export interface TranslationProvider {
  readonly id: string;
  translateSegments(
    segments: string[],
    targetLang: TranslationLang,
    options?: { context?: string }
  ): Promise<TranslationSegmentResult>;
}

export interface TranslateItemInput {
  key: string;
  text: string;
  format?: TranslationFormat;
}

export interface TranslateItemOutput {
  text: string;
  cached: boolean;
  detectedSourceLang: string | null;
}
