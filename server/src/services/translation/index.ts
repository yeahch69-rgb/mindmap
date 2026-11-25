import crypto from 'crypto';
import { db } from '../../db/database.js';
import { scheduleCloudBackup } from '../../db/cloudSync.js';
import { getJstDateTimeStr } from '../../utils/jstTime.js';
import { GeminiTranslationProvider } from './geminiProvider.js';
import { GoogleUnofficialProvider } from './googleUnofficialProvider.js';
import { translateHtmlContent } from './htmlTranslator.js';
import { needsTranslation } from './languageDetect.js';
import {
  getTranslationUsageStats,
  recordTranslationCacheHit,
  resetTranslationUsageStats,
  TranslationUsageSummary,
} from './usageStats.js';
import {
  TranslateItemInput,
  TranslateItemOutput,
  TranslationError,
  TranslationFormat,
  TranslationLang,
  TranslationProvider,
} from './types.js';

export * from './types.js';
export { needsTranslation } from './languageDetect.js';

const HTML_TAG_DETECT_RE = /<\/?(?:p|br|strong|b|em|i|s|del|u|h[1-6]|ul|ol|li|blockquote|span|div)(?:\s[^>]*)?>/i;
const MAX_CONCURRENT_UPSTREAM = 5;
const MIN_UPSTREAM_SPACING_MS = 30;

const providers: Record<string, TranslationProvider> = {
  gemini: new GeminiTranslationProvider(),
  'google-unofficial': new GoogleUnofficialProvider(),
};

/**
 * Resolves the active translation provider from `TRANSLATION_PROVIDER` env var.
 * If unset and `GEMINI_API_KEY` is configured, defaults to `gemini`.
 */
export function getActiveTranslationProvider(): TranslationProvider {
  const defaultProvider = (process.env.GEMINI_API_KEY || '').trim() ? 'gemini' : 'google-unofficial';
  const configured = (process.env.TRANSLATION_PROVIDER || defaultProvider).trim().toLowerCase();
  const provider = providers[configured];
  if (!provider) {
    console.warn(`[Translation] Unknown TRANSLATION_PROVIDER="${configured}", falling back to ${defaultProvider}.`);
    return providers[defaultProvider];
  }
  return provider;
}

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveFormat(text: string, explicitFormat?: TranslationFormat): TranslationFormat {
  if (explicitFormat === 'html' || explicitFormat === 'text') return explicitFormat;
  return HTML_TAG_DETECT_RE.test(text) ? 'html' : 'text';
}

// Simple async concurrency & spacing limiter for upstream calls (protects Render single IP from 429)
let activeUpstreamCount = 0;
let lastUpstreamStartAt = 0;
const upstreamWaitQueue: Array<() => void> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireUpstreamSlot(): Promise<void> {
  while (activeUpstreamCount >= MAX_CONCURRENT_UPSTREAM) {
    await new Promise<void>((resolve) => upstreamWaitQueue.push(resolve));
  }
  activeUpstreamCount++;

  const now = Date.now();
  const elapsed = now - lastUpstreamStartAt;
  if (elapsed < MIN_UPSTREAM_SPACING_MS) {
    await sleep(MIN_UPSTREAM_SPACING_MS - elapsed);
  }
  lastUpstreamStartAt = Date.now();
}

function releaseUpstreamSlot(): void {
  activeUpstreamCount = Math.max(0, activeUpstreamCount - 1);
  const next = upstreamWaitQueue.shift();
  if (next) next();
}

// In-flight deduplication map: concurrent clicks on the same text share a single upstream call
const inFlightRequests = new Map<string, Promise<TranslateItemOutput>>();

interface CacheRow {
  id: number;
  translated_text: string;
  detected_source_lang: string | null;
}

function lookupCache(
  sourceHash: string,
  targetLang: TranslationLang,
  providerId: string,
  format: TranslationFormat
): CacheRow | undefined {
  return db
    .prepare(
      `SELECT id, translated_text, detected_source_lang
       FROM translation_cache
       WHERE source_hash = ? AND target_lang = ? AND provider = ? AND content_format = ?`
    )
    .get(sourceHash, targetLang, providerId, format) as CacheRow | undefined;
}

function touchCacheHit(id: number): void {
  try {
    db.prepare(
      `UPDATE translation_cache
       SET hit_count = hit_count + 1, last_used_at = ?
       WHERE id = ?`
    ).run(getJstDateTimeStr(), id);
  } catch (err) {
    console.warn('[Translation] Failed to touch cache hit:', err);
  }
}

function saveCacheEntry(
  sourceHash: string,
  targetLang: TranslationLang,
  providerId: string,
  format: TranslationFormat,
  detectedSourceLang: string | null,
  translatedText: string
): void {
  try {
    const nowJst = getJstDateTimeStr();
    db.prepare(
      `INSERT INTO translation_cache
        (source_hash, target_lang, provider, content_format, detected_source_lang, translated_text, created_at, last_used_at, hit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(source_hash, target_lang, provider, content_format)
       DO UPDATE SET
         translated_text = excluded.translated_text,
         detected_source_lang = excluded.detected_source_lang,
         last_used_at = excluded.last_used_at,
         hit_count = translation_cache.hit_count + 1`
    ).run(sourceHash, targetLang, providerId, format, detectedSourceLang, translatedText, nowJst, nowJst);

    // Gentle debounced backup so translation cache survives Render restarts without flooding cloud sync
    scheduleCloudBackup('translation_cache', 30000);
  } catch (err) {
    console.warn('[Translation] Failed to save translation cache:', err);
  }
}

async function translateSingleItem(
  text: string,
  targetLang: TranslationLang,
  format: TranslationFormat,
  provider: TranslationProvider,
  context?: string
): Promise<TranslateItemOutput> {
  if (!text || !text.trim()) {
    return { text: text || '', cached: false, detectedSourceLang: null };
  }

  // Skip upstream call when text is already purely in viewer's target language or non-linguistic
  if (!needsTranslation(text, targetLang)) {
    return { text, cached: false, detectedSourceLang: targetLang };
  }

  const sourceHash = sha256Hex(text);

  // 1. Check SQLite persistent cache
  const cachedRow = lookupCache(sourceHash, targetLang, provider.id, format);
  if (cachedRow) {
    touchCacheHit(cachedRow.id);
    recordTranslationCacheHit();
    return {
      text: cachedRow.translated_text,
      cached: true,
      detectedSourceLang: cachedRow.detected_source_lang,
    };
  }

  // 2. Deduplicate in-flight requests for the exact same content & target language
  const flightKey = `${provider.id}:${targetLang}:${format}:${sourceHash}`;
  const existingFlight = inFlightRequests.get(flightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const promise = (async (): Promise<TranslateItemOutput> => {
    await acquireUpstreamSlot();
    try {
      // Double-check cache in case another worker populated it while we waited in queue
      const doubleCheck = lookupCache(sourceHash, targetLang, provider.id, format);
      if (doubleCheck) {
        touchCacheHit(doubleCheck.id);
        return {
          text: doubleCheck.translated_text,
          cached: true,
          detectedSourceLang: doubleCheck.detected_source_lang,
        };
      }

      let translatedText: string;
      let detectedSourceLang: string | null = null;

      if (format === 'html') {
        const htmlRes = await translateHtmlContent(text, targetLang, provider, { context });
        translatedText = htmlRes.translatedHtml;
        detectedSourceLang = htmlRes.detectedSourceLang;
      } else {
        const plainRes = await provider.translateSegments([text], targetLang, { context });
        translatedText = plainRes.translatedTexts[0] ?? text;
        detectedSourceLang = plainRes.detectedSourceLang;
      }

      saveCacheEntry(sourceHash, targetLang, provider.id, format, detectedSourceLang, translatedText);

      return {
        text: translatedText,
        cached: false,
        detectedSourceLang,
      };
    } finally {
      releaseUpstreamSlot();
      inFlightRequests.delete(flightKey);
    }
  })();

  inFlightRequests.set(flightKey, promise);
  return promise;
}

export async function translateItemsBatch(
  items: TranslateItemInput[],
  targetLang: TranslationLang,
  context?: string
): Promise<{
  provider: string;
  targetLang: TranslationLang;
  results: Record<string, TranslateItemOutput>;
}> {
  const provider = getActiveTranslationProvider();
  const results: Record<string, TranslateItemOutput> = {};

  // Process items sequentially within one request to preserve polite upstream spacing
  // while still hitting SQLite cache instantaneously for already-cached fields.
  for (const item of items) {
    const rawText = typeof item.text === 'string' ? item.text : '';
    const format = resolveFormat(rawText, item.format);
    if (rawText.length > 50000) {
      throw new TranslationError(
        'INVALID_INPUT',
        '번역할 텍스트가 너무 깁니다.',
        400
      );
    }
    results[item.key] = await translateSingleItem(rawText, targetLang, format, provider, context);
  }

  return {
    provider: provider.id,
    targetLang,
    results,
  };
}

function getConfiguredGeminiModel(): string {
  return (process.env.GEMINI_TRANSLATION_MODEL || 'gemini-3.1-flash-lite').trim();
}

export function getAdminTranslationUsage(): TranslationUsageSummary {
  const provider = getActiveTranslationProvider();
  return getTranslationUsageStats(provider.id, getConfiguredGeminiModel());
}

export function resetAdminTranslationUsage(): TranslationUsageSummary {
  const provider = getActiveTranslationProvider();
  return resetTranslationUsageStats(provider.id, getConfiguredGeminiModel());
}
