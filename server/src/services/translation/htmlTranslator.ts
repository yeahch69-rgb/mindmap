import { TranslationLang, TranslationProvider } from './types.js';

interface HtmlToken {
  type: 'tag' | 'text';
  raw: string;
}

const HTML_TOKEN_RE = /(<\/?[a-zA-Z][^>]*>)/g;
const MEANINGFUL_TEXT_RE = /[\p{L}]/u;

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, '\u00A0')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tokenizeHtml(html: string): HtmlToken[] {
  const parts = html.split(HTML_TOKEN_RE);
  const tokens: HtmlToken[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<') && part.endsWith('>')) {
      tokens.push({ type: 'tag', raw: part });
    } else {
      tokens.push({ type: 'text', raw: part });
    }
  }
  return tokens;
}

/**
 * Extracts visible text nodes from rich HTML, translates them via the provider in a batch,
 * and reconstructs the original HTML structure with all formatting tags and inline colors intact.
 */
export async function translateHtmlContent(
  html: string,
  targetLang: TranslationLang,
  provider: TranslationProvider,
  options?: { context?: string }
): Promise<{ translatedHtml: string; detectedSourceLang: string | null }> {
  const tokens = tokenizeHtml(html);

  interface TranslatableSlot {
    tokenIndex: number;
    leadingWs: string;
    trailingWs: string;
    coreText: string;
  }

  const slots: TranslatableSlot[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'text') continue;
    const decoded = decodeBasicEntities(token.raw);
    if (!MEANINGFUL_TEXT_RE.test(decoded)) continue;

    const leadingMatch = decoded.match(/^[\s\u00A0]+/);
    const trailingMatch = decoded.match(/[\s\u00A0]+$/);
    const leadingWs = leadingMatch ? leadingMatch[0] : '';
    const trailingWs = trailingMatch ? trailingMatch[0] : '';
    const coreText = decoded.slice(leadingWs.length, decoded.length - trailingWs.length);
    if (!coreText || !MEANINGFUL_TEXT_RE.test(coreText)) continue;

    slots.push({
      tokenIndex: i,
      leadingWs,
      trailingWs,
      coreText,
    });
  }

  if (slots.length === 0) {
    return { translatedHtml: html, detectedSourceLang: null };
  }

  const segments = slots.map((s) => s.coreText);
  const result = await provider.translateSegments(segments, targetLang, options);

  const rebuiltTokens = tokens.map((t) => t.raw);
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const translatedCore = result.translatedTexts[i] ?? slot.coreText;
    const safeLeading = slot.leadingWs.replace(/\u00A0/g, '&nbsp;');
    const safeTrailing = slot.trailingWs.replace(/\u00A0/g, '&nbsp;');
    rebuiltTokens[slot.tokenIndex] = `${safeLeading}${escapeHtmlText(translatedCore)}${safeTrailing}`;
  }

  return {
    translatedHtml: rebuiltTokens.join(''),
    detectedSourceLang: result.detectedSourceLang,
  };
}
