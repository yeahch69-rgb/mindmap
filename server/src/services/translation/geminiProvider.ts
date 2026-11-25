import {
  TranslationError,
  TranslationLang,
  TranslationProvider,
  TranslationSegmentResult,
} from './types.js';
import { recordGeminiApiUsage } from './usageStats.js';

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const REQUEST_TIMEOUT_MS = 12000;
const MAX_BATCH_SEGMENTS = 40;
const MAX_BATCH_CHARS = 6000;

const LANG_NAMES: Record<TranslationLang, string> = {
  ko: 'Korean',
  ja: 'Japanese',
  en: 'English',
};

function getGeminiConfig(): { apiKey: string; model: string } {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const model = (process.env.GEMINI_TRANSLATION_MODEL || DEFAULT_GEMINI_MODEL).trim();
  if (!apiKey) {
    throw new TranslationError(
      'UNSUPPORTED_PROVIDER',
      '번역 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.',
      503
    );
  }
  return { apiKey, model };
}

function buildSystemInstruction(targetLang: TranslationLang): string {
  const targetName = LANG_NAMES[targetLang];
  return [
    `You are a faithful translator for Project Mindmap (a general personal and team project journal, mindmap, shared calendar, and memo app).`,
    `Translate the provided text accurately into ${targetName}, staying true to the original meaning, tone, and conciseness.`,
    `Rules:`,
    `1. Preserve the original tone, register, and brevity (e.g., casual, memo/note style, or polite) — do NOT artificially make casual/note-style text overly formal, and do NOT add honorifics or titles (such as "씨", "님", "さん", "Mr./Ms.") that are not in the source text.`,
    `2. Do NOT add any words, explanations, or context that are not present in the original text.`,
    `3. Preserve all numbers, dates, times, currency amounts, URLs, emails, and proper codes/IDs exactly.`,
    `4. Preserve line breaks and paragraph structure.`,
    `5. If a segment is already in ${targetName}, keep it as-is in ${targetName}.`,
    `6. Output ONLY the translated text (or exact JSON schema requested). Never add commentary, quotes, or markdown fences.`,
  ].join('\n');
}

async function callGeminiApi(
  systemInstruction: string,
  userPrompt: string,
  responseMimeType: 'text/plain' | 'application/json' = 'text/plain'
): Promise<string> {
  const { apiKey, model } = getGeminiConfig();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType,
        },
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new TranslationError(
        'RATE_LIMITED',
        '번역 요청이 일시적으로 많습니다. 잠시 후 다시 시도해 주세요.',
        429
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new TranslationError(
        'UNSUPPORTED_PROVIDER',
        '번역 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.',
        503
      );
    }

    if (!res.ok) {
      throw new TranslationError(
        'UPSTREAM_ERROR',
        '번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        502
      );
    }

    const data = (await res.json()) as any;
    const usage = data?.usageMetadata;
    const promptTokens = Number(usage?.promptTokenCount || 0);
    const candidateTokens = Number(usage?.candidatesTokenCount || 0);
    const thoughtTokens = Number(usage?.thoughtsTokenCount || 0);
    const resolvedModel = typeof data?.modelVersion === 'string' && data.modelVersion.trim()
      ? data.modelVersion.trim()
      : model;
    recordGeminiApiUsage(promptTokens, candidateTokens + thoughtTokens, resolvedModel);

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();

    if (!text) {
      throw new TranslationError(
        'UPSTREAM_ERROR',
        '번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        502
      );
    }

    return text;
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
      '번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      502
    );
  } finally {
    clearTimeout(timer);
  }
}

export class GeminiTranslationProvider implements TranslationProvider {
  public readonly id = 'gemini';

  private async translateSingle(
    text: string,
    targetLang: TranslationLang
  ): Promise<string> {
    if (!text || !text.trim()) return text;
    const systemInstruction = buildSystemInstruction(targetLang);
    return callGeminiApi(systemInstruction, text, 'text/plain');
  }

  async translateSegments(
    segments: string[],
    targetLang: TranslationLang,
    _options?: { context?: string }
  ): Promise<TranslationSegmentResult> {
    if (segments.length === 0) {
      return { translatedTexts: [], detectedSourceLang: null };
    }
    if (segments.length === 1) {
      const translated = await this.translateSingle(segments[0], targetLang);
      return { translatedTexts: [translated], detectedSourceLang: null };
    }

    const translatedTexts: string[] = new Array(segments.length);
    let cursor = 0;

    while (cursor < segments.length) {
      const batchIndices: number[] = [];
      const batchTexts: string[] = [];
      let totalChars = 0;

      while (cursor < segments.length && batchIndices.length < MAX_BATCH_SEGMENTS) {
        const seg = segments[cursor];
        if (batchIndices.length > 0 && totalChars + seg.length > MAX_BATCH_CHARS) {
          break;
        }
        batchIndices.push(cursor);
        batchTexts.push(seg);
        totalChars += seg.length;
        cursor += 1;
      }

      const systemInstruction = [
        buildSystemInstruction(targetLang),
        `Return a JSON object with a single key "translations" containing an array of exactly ${batchTexts.length} translated strings in the exact same order as the input array.`,
      ].join('\n');

      const userPrompt = JSON.stringify({ texts: batchTexts });

      let parsedArray: string[] | null = null;
      try {
        const rawJson = await callGeminiApi(systemInstruction, userPrompt, 'application/json');
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed?.translations) && parsed.translations.length === batchTexts.length) {
          parsedArray = parsed.translations.map((item: unknown, idx: number) =>
            typeof item === 'string' ? item : batchTexts[idx]
          );
        }
      } catch (err) {
        if (err instanceof TranslationError && err.code === 'RATE_LIMITED') {
          throw err;
        }
        parsedArray = null;
      }

      if (parsedArray) {
        for (let i = 0; i < batchIndices.length; i++) {
          translatedTexts[batchIndices[i]] = parsedArray[i];
        }
      } else {
        for (let i = 0; i < batchIndices.length; i++) {
          translatedTexts[batchIndices[i]] = await this.translateSingle(batchTexts[i], targetLang);
        }
      }
    }

    return { translatedTexts, detectedSourceLang: null };
  }
}
