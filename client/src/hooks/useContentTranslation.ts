import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Language } from '../types';
import { anyNeedsTranslation, needsTranslation } from '../utils/languageDetect';
import { isHtmlContent } from '../utils/richText';

export type TranslationFieldFormat = 'text' | 'html';

export type TranslationFieldSpec =
  | string
  | null
  | undefined
  | {
      text?: string | null;
      format?: TranslationFieldFormat;
    };

export type TranslationFieldsMap = Record<string, TranslationFieldSpec>;

interface TranslatedFieldRecord {
  source: string;
  translated: string;
}

interface TranslatedItemState {
  lang: Language;
  active: boolean;
  fields: Record<string, TranslatedFieldRecord>;
}

interface TranslateApiResponse {
  provider: string;
  targetLang: Language;
  results: Record<
    string,
    {
      text: string;
      cached: boolean;
      detectedSourceLang: string | null;
    }
  >;
}

// Client-side session memory cache shared across views/modals (instant repeat toggle)
const MAX_CLIENT_CACHE_ENTRIES = 1500;
const clientTranslationCache = new Map<string, string>();

export function isGuestAccountEmail(email?: string | null): boolean {
  const normalized = (email || '').trim().toLowerCase();
  return /^demo-[a-z0-9]+@(?:mindmap|journal)\.local$/.test(normalized);
}

function makeCacheKey(lang: Language, format: TranslationFieldFormat, text: string): string {
  return `${lang}|${format}|${text}`;
}

function getCachedTranslation(lang: Language, format: TranslationFieldFormat, text: string): string | undefined {
  return clientTranslationCache.get(makeCacheKey(lang, format, text));
}

function setCachedTranslation(lang: Language, format: TranslationFieldFormat, text: string, translated: string): void {
  const key = makeCacheKey(lang, format, text);
  if (clientTranslationCache.size >= MAX_CLIENT_CACHE_ENTRIES && !clientTranslationCache.has(key)) {
    const firstKey = clientTranslationCache.keys().next().value;
    if (firstKey !== undefined) {
      clientTranslationCache.delete(firstKey);
    }
  }
  clientTranslationCache.set(key, translated);
}

function normalizeField(spec: TranslationFieldSpec): { text: string; format: TranslationFieldFormat } | null {
  if (spec === null || spec === undefined) return null;
  if (typeof spec === 'string') {
    if (!spec.trim()) return null;
    return { text: spec, format: isHtmlContent(spec) ? 'html' : 'text' };
  }
  const text = spec.text ?? '';
  if (!text.trim()) return null;
  const format = spec.format ?? (isHtmlContent(text) ? 'html' : 'text');
  return { text, format };
}

/**
 * Shared hook for on-demand content translation across Project Mindmap tabs.
 *
 * - Default always shows original text.
 * - Clicking Translate replaces specified fields with viewer's current UI language (`ko` / `ja` / `en`).
 * - Clicking again toggles back to original text cleanly without extra network calls.
 * - Guest (demo-*) accounts are blocked and shown a localized sign-in notice.
 */
export function useContentTranslation() {
  const { language, L } = useLanguage();
  const { user } = useAuth();
  const isGuest = isGuestAccountEmail(user?.email);
  const [items, setItems] = useState<Record<string, TranslatedItemState>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const errorTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Reset active toggles cleanly when user switches their UI language
  useEffect(() => {
    setItems({});
    setErrorMap({});
  }, [language]);

  useEffect(() => {
    return () => {
      Object.values(errorTimersRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  const setTransientError = useCallback((itemId: string, message: string) => {
    if (errorTimersRef.current[itemId]) {
      clearTimeout(errorTimersRef.current[itemId]);
    }
    setErrorMap((prev) => ({ ...prev, [itemId]: message }));
    errorTimersRef.current[itemId] = setTimeout(() => {
      setErrorMap((prev) => {
        if (!(itemId in prev)) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      delete errorTimersRef.current[itemId];
    }, 6000);
  }, []);

  const clearError = useCallback((itemId: string) => {
    if (errorTimersRef.current[itemId]) {
      clearTimeout(errorTimersRef.current[itemId]);
      delete errorTimersRef.current[itemId];
    }
    setErrorMap((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const isTranslated = useCallback(
    (itemId: string): boolean => {
      const entry = items[itemId];
      return Boolean(entry && entry.active && entry.lang === language);
    },
    [items, language]
  );

  const isTranslating = useCallback(
    (itemId: string): boolean => Boolean(loadingMap[itemId]),
    [loadingMap]
  );

  const getError = useCallback(
    (itemId: string): string | null => errorMap[itemId] || null,
    [errorMap]
  );

  const shouldShowButton = useCallback(
    (...texts: Array<string | null | undefined>): boolean => {
      return anyNeedsTranslation(texts, language);
    },
    [language]
  );

  const getText = useCallback(
    (itemId: string, fieldKey: string, original: string | null | undefined): string => {
      const orig = original ?? '';
      const entry = items[itemId];
      if (!entry || !entry.active || entry.lang !== language) return orig;
      const rec = entry.fields[fieldKey];
      if (!rec) return orig;
      if (rec.source !== orig) return orig;
      return rec.translated;
    },
    [items, language]
  );

  const toggleTranslate = useCallback(
    async (itemId: string, fields: TranslationFieldsMap, context?: string): Promise<void> => {
      if (loadingMap[itemId]) return;
      clearError(itemId);

      if (isGuest) {
        setTransientError(
          itemId,
          L(
            '정식 회원 로그인 후 번역 기능을 이용할 수 있습니다.',
            '正式アカウントでログインすると翻訳機能を利用できます。',
            'Sign in with a registered account to use translation.'
          )
        );
        return;
      }

      const normalizedEntries: Array<{ key: string; text: string; format: TranslationFieldFormat }> = [];
      for (const [key, spec] of Object.entries(fields)) {
        const norm = normalizeField(spec);
        if (norm) {
          normalizedEntries.push({ key, ...norm });
        }
      }
      if (normalizedEntries.length === 0) return;

      const existing = items[itemId];
      if (existing && existing.active && existing.lang === language) {
        setItems((prev) => ({
          ...prev,
          [itemId]: { ...prev[itemId], active: false },
        }));
        return;
      }

      const resolvedFields: Record<string, TranslatedFieldRecord> = {};
      const missingForApi: Array<{ key: string; text: string; format: TranslationFieldFormat }> = [];

      for (const entry of normalizedEntries) {
        if (!needsTranslation(entry.text, language)) {
          resolvedFields[entry.key] = { source: entry.text, translated: entry.text };
          continue;
        }
        const cached = getCachedTranslation(language, entry.format, entry.text);
        if (cached !== undefined) {
          resolvedFields[entry.key] = { source: entry.text, translated: cached };
        } else {
          missingForApi.push(entry);
        }
      }

      if (missingForApi.length === 0) {
        setItems((prev) => ({
          ...prev,
          [itemId]: {
            lang: language,
            active: true,
            fields: { ...(prev[itemId]?.lang === language ? prev[itemId].fields : {}), ...resolvedFields },
          },
        }));
        return;
      }

      setLoadingMap((prev) => ({ ...prev, [itemId]: true }));
      try {
        const resp = await api.post<TranslateApiResponse>('/translate', {
          targetLang: language,
          context,
          items: missingForApi.map((m) => ({
            key: m.key,
            text: m.text,
            format: m.format,
          })),
        });

        for (const reqItem of missingForApi) {
          const translated = resp?.results?.[reqItem.key]?.text ?? reqItem.text;
          setCachedTranslation(language, reqItem.format, reqItem.text, translated);
          resolvedFields[reqItem.key] = { source: reqItem.text, translated };
        }

        setItems((prev) => ({
          ...prev,
          [itemId]: {
            lang: language,
            active: true,
            fields: { ...(prev[itemId]?.lang === language ? prev[itemId].fields : {}), ...resolvedFields },
          },
        }));
      } catch (err: any) {
        const fallbackMsg = L(
          '번역에 실패했습니다. 잠시 후 다시 시도해 주세요.',
          '翻訳に失敗しました。しばらくしてから再試行してください。',
          'Translation failed. Please try again shortly.'
        );
        setTransientError(itemId, err?.message || fallbackMsg);
      } finally {
        setLoadingMap((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    },
    [clearError, isGuest, items, L, language, loadingMap, setTransientError]
  );

  return {
    language,
    isGuest,
    isTranslated,
    isTranslating,
    getError,
    getText,
    shouldShowButton,
    toggleTranslate,
  };
}
