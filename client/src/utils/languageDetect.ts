import { Language } from '../types';

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

/**
 * Determines whether a piece of user-authored text likely contains language
 * different from the viewer's current UI language (`ko` | `ja` | `en`).
 */
export function needsTranslation(raw: string | null | undefined, targetLang: Language): boolean {
  if (!raw || !raw.trim()) return false;
  const cleaned = stripMarkupAndNoise(raw);
  const ko = (cleaned.match(HANGUL_RE) || []).length;
  const kana = (cleaned.match(KANA_RE) || []).length;
  const cjk = (cleaned.match(CJK_RE) || []).length;
  const latin = (cleaned.match(LATIN_RE) || []).length;
  const total = ko + kana + cjk + latin;
  if (total < 2) return false;

  const latinWithoutAcronyms = (cleaned.replace(SHORT_ACRONYM_RE, ' ').match(LATIN_RE) || []).length;

  if (targetLang === 'ko') {
    if (kana > 0 || cjk > 0) return true;
    if (ko === 0 && latin >= 2) return true;
    if (
      latinWithoutAcronyms >= 6 &&
      latinWithoutAcronyms / Math.max(1, ko + latinWithoutAcronyms) >= 0.35
    ) {
      return true;
    }
    return false;
  }

  if (targetLang === 'ja') {
    if (ko > 0) return true;
    const jpChars = kana + cjk;
    if (jpChars === 0 && latin >= 2) return true;
    if (
      latinWithoutAcronyms >= 6 &&
      latinWithoutAcronyms / Math.max(1, jpChars + latinWithoutAcronyms) >= 0.35
    ) {
      return true;
    }
    return false;
  }

  // targetLang === 'en'
  if (ko > 0 || kana > 0 || cjk > 0) return true;
  return false;
}

/**
 * Returns true if any non-empty text in the provided list needs translation into `targetLang`.
 */
export function anyNeedsTranslation(
  texts: Array<string | null | undefined>,
  targetLang: Language
): boolean {
  for (const t of texts) {
    if (needsTranslation(t, targetLang)) return true;
  }
  return false;
}
