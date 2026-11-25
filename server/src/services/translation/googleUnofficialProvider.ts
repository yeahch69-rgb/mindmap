import {
  TranslationError,
  TranslationLang,
  TranslationProvider,
  TranslationSegmentResult,
} from './types.js';

const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const REQUEST_TIMEOUT_MS = 6500;
const MAX_BATCH_CHARS = 2400;
const MAX_SINGLE_CHUNK_CHARS = 3200;

/**
 * Splits a very long plain-text block into chunks along paragraph / newline / sentence boundaries
 * so we never exceed unofficial endpoint length limits.
 */
function chunkLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/(\n+)/);
  let current = '';

  for (const part of paragraphs) {
    if ((current + part).length <= maxChars) {
      current += part;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = '';
    }
    if (part.length <= maxChars) {
      current = part;
      continue;
    }
    // Split oversized single paragraph safely
    let remaining = part;
    while (remaining.length > maxChars) {
      let splitIdx = remaining.lastIndexOf(' ', maxChars);
      if (splitIdx < Math.floor(maxChars * 0.5)) {
        splitIdx = remaining.lastIndexOf('。', maxChars);
      }
      if (splitIdx < Math.floor(maxChars * 0.5)) {
        splitIdx = maxChars;
      } else {
        splitIdx += 1;
      }
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx);
    }
    current = remaining;
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function callGoogleUnofficialApi(
  text: string,
  targetLang: TranslationLang
): Promise<{ translated: string; detectedSourceLang: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const queryParams = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: targetLang,
      dt: 't',
    });

    let res: Response;
    if (text.length <= 1000) {
      queryParams.set('q', text);
      res = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${queryParams.toString()}`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NYGCWorkspace/1.0)',
          Accept: 'application/json,text/plain,*/*',
        },
      });
    } else {
      const formBody = new URLSearchParams({ q: text });
      res = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${queryParams.toString()}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (compatible; NYGCWorkspace/1.0)',
          Accept: 'application/json,text/plain,*/*',
        },
        body: formBody.toString(),
      });
    }

    if (res.status === 429) {
      throw new TranslationError(
        'RATE_LIMITED',
        '번역 요청이 일시적으로 몰렸습니다. 잠시 후 다시 시도해 주세요.',
        429
      );
    }

    if (!res.ok) {
      throw new TranslationError(
        'UPSTREAM_ERROR',
        '번역 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        503
      );
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new TranslationError(
        'UPSTREAM_ERROR',
        '번역 결과를 해석할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        503
      );
    }

    const sentences = data[0] as Array<unknown>;
    let translated = '';
    for (const part of sentences) {
      if (Array.isArray(part) && typeof part[0] === 'string') {
        translated += part[0];
      }
    }

    const detectedSourceLang = typeof data[2] === 'string' ? data[2] : null;
    return { translated, detectedSourceLang };
  } catch (err: any) {
    if (err instanceof TranslationError) throw err;
    if (err?.name === 'AbortError') {
      throw new TranslationError(
        'TIMEOUT',
        '번역 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
        504
      );
    }
    throw new TranslationError(
      'UPSTREAM_ERROR',
      '번역 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

async function translateSingleText(
  text: string,
  targetLang: TranslationLang
): Promise<{ translated: string; detectedSourceLang: string | null }> {
  if (!text.trim()) {
    return { translated: text, detectedSourceLang: null };
  }

  const chunks = chunkLongText(text, MAX_SINGLE_CHUNK_CHARS);
  if (chunks.length === 1) {
    return callGoogleUnofficialApi(chunks[0], targetLang);
  }

  const out: string[] = [];
  let detected: string | null = null;
  for (const chunk of chunks) {
    if (!chunk.trim()) {
      out.push(chunk);
      continue;
    }
    const res = await callGoogleUnofficialApi(chunk, targetLang);
    out.push(res.translated);
    if (!detected && res.detectedSourceLang) {
      detected = res.detectedSourceLang;
    }
  }
  return { translated: out.join(''), detectedSourceLang: detected };
}

/**
 * Attempts to translate a small batch of segments in a single HTTP request using resilient
 * numeric sentinels. If Google Translate alters/drops any sentinel, returns null so the caller
 * seamlessly falls back to individual translation.
 */
async function tryTranslateBatchTogether(
  batch: string[],
  targetLang: TranslationLang
): Promise<{ translatedTexts: string[]; detectedSourceLang: string | null } | null> {
  if (batch.length <= 1) return null;

  const markerFor = (idx: number) => `⟦901${idx}901⟧`;
  const joined = batch.map((seg, i) => `${markerFor(i)}\n${seg}`).join('\n');
  if (joined.length > MAX_BATCH_CHARS) return null;

  const res = await callGoogleUnofficialApi(joined, targetLang);
  const raw = res.translated;

  // Match markers even if translator inserted spaces around brackets/digits
  const markerRe = /⟦\s*901\s*(\d+)\s*901\s*⟧/g;
  const matches = [...raw.matchAll(markerRe)];
  if (matches.length !== batch.length) {
    return null;
  }

  const extracted: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (Number(m[1]) !== i) return null;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length;
    let piece = raw.slice(start, end);
    // Strip the single synthetic boundary newline added around sentinels
    if (piece.startsWith('\n')) piece = piece.slice(1);
    else if (piece.startsWith(' ')) piece = piece.slice(1);
    if (piece.endsWith('\n')) piece = piece.slice(0, -1);
    extracted.push(piece);
  }

  return {
    translatedTexts: extracted,
    detectedSourceLang: res.detectedSourceLang,
  };
}

/**
 * Phase 1 Provider: Unofficial free Google Translate endpoint (`client=gtx`).
 * Zero API key / billing required. Designed to be replaced cleanly by Gemini/OpenAI/Cloud v2.
 */
export class GoogleUnofficialProvider implements TranslationProvider {
  readonly id = 'google-unofficial';

  async translateSegments(
    segments: string[],
    targetLang: TranslationLang
  ): Promise<TranslationSegmentResult> {
    if (segments.length === 0) {
      return { translatedTexts: [], detectedSourceLang: null };
    }

    if (segments.length === 1) {
      const single = await translateSingleText(segments[0], targetLang);
      return {
        translatedTexts: [single.translated],
        detectedSourceLang: single.detectedSourceLang,
      };
    }

    // Group segments into bounded batches so rich HTML with many nodes stays fast (1~2 upstream calls)
    const results: string[] = new Array(segments.length);
    let detectedSourceLang: string | null = null;

    let cursor = 0;
    while (cursor < segments.length) {
      const batchIndices: number[] = [];
      const batchTexts: string[] = [];
      let batchLen = 0;

      while (cursor < segments.length && batchTexts.length < 25) {
        const seg = segments[cursor];
        const projected = batchLen + seg.length + 24;
        if (batchTexts.length > 0 && projected > MAX_BATCH_CHARS) {
          break;
        }
        batchIndices.push(cursor);
        batchTexts.push(seg);
        batchLen = projected;
        cursor++;
      }

      if (batchTexts.length === 1) {
        const single = await translateSingleText(batchTexts[0], targetLang);
        results[batchIndices[0]] = single.translated;
        if (!detectedSourceLang && single.detectedSourceLang) {
          detectedSourceLang = single.detectedSourceLang;
        }
        continue;
      }

      const batched = await tryTranslateBatchTogether(batchTexts, targetLang);
      if (batched) {
        for (let i = 0; i < batchIndices.length; i++) {
          results[batchIndices[i]] = batched.translatedTexts[i];
        }
        if (!detectedSourceLang && batched.detectedSourceLang) {
          detectedSourceLang = batched.detectedSourceLang;
        }
      } else {
        // Safe per-segment fallback if markers were perturbed
        for (let i = 0; i < batchIndices.length; i++) {
          const single = await translateSingleText(batchTexts[i], targetLang);
          results[batchIndices[i]] = single.translated;
          if (!detectedSourceLang && single.detectedSourceLang) {
            detectedSourceLang = single.detectedSourceLang;
          }
        }
      }
    }

    return {
      translatedTexts: results,
      detectedSourceLang,
    };
  }
}
