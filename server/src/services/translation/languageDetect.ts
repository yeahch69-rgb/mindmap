import { TranslationLang } from './types.js';

const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g;
const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9F]/g;
const CJK_RE = /[\u4E00-\u9FFF]/g;
const LATIN_RE = /[A-Za-z]/g;
const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SHORT_ACRONYM_RE = /\b[A-Z]{2,5}\b/g;

function stripMarkupAndNoise(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/gi, ' ')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .trim();
}

export interface ScriptStats {
  ko: number;
  kana: number;
  cjk: number;
  latin: number;
  latinWithoutAcronyms: number;
  total: number;
}

export function analyzeScripts(raw: string): ScriptStats {
  const cleaned = stripMarkupAndNoise(raw);
  const ko = (cleaned.match(HANGUL_RE) || []).length;
  const kana = (cleaned.match(KANA_RE) || []).length;
  const cjk = (cleaned.match(CJK_RE) || []).length;
  const latin = (cleaned.match(LATIN_RE) || []).length;
  const latinWithoutAcronyms = (cleaned.replace(SHORT_ACRONYM_RE, ' ').match(LATIN_RE) || []).length;
  return {
    ko,
    kana,
    cjk,
    latin,
    latinWithoutAcronyms,
    total: ko + kana + cjk + latin,
  };
}

/**
 * Lightweight heuristic check to determine whether `raw` likely needs translation
 * for a viewer reading in `targetLang`.
 */
export function needsTranslation(raw: string | null | undefined, targetLang: TranslationLang): boolean {
  if (!raw || !raw.trim()) return false;
  const stats = analyzeScripts(raw);
  if (stats.total < 2) return false;

  if (targetLang === 'ko') {
    if (stats.kana > 0 || stats.cjk > 0) return true;
    if (stats.ko === 0 && stats.latin >= 2) return true;
    // Mixed Korean + meaningful English prose (ignoring short brand acronyms like NYGC/PDF/VIP)
    if (stats.latinWithoutAcronyms >= 6 && stats.latinWithoutAcronyms / Math.max(1, stats.ko + stats.latinWithoutAcronyms) >= 0.35) {
      return true;
    }
    return false;
  }

  if (targetLang === 'ja') {
    if (stats.ko > 0) return true;
    const jpChars = stats.kana + stats.cjk;
    if (jpChars === 0 && stats.latin >= 2) return true;
    if (stats.latinWithoutAcronyms >= 6 && stats.latinWithoutAcronyms / Math.max(1, jpChars + stats.latinWithoutAcronyms) >= 0.35) {
      return true;
    }
    return false;
  }

  // targetLang === 'en'
  if (stats.ko > 0 || stats.kana > 0 || stats.cjk > 0) return true;
  return false;
}
