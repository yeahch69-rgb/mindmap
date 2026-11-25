import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getAdminTranslationUsage,
  resetAdminTranslationUsage,
  TranslateItemInput,
  TranslationError,
  TranslationLang,
  translateItemsBatch,
} from '../services/translation/index.js';

const router = express.Router();

const ALLOWED_LANGS = new Set<TranslationLang>(['ko', 'ja', 'en']);
const MAX_BATCH_ITEMS = 60;

export function isGuestAccountEmail(email?: string | null): boolean {
  const normalized = (email || '').trim().toLowerCase();
  return /^demo-[a-z0-9]+@(?:mindmap|journal)\.local$/.test(normalized);
}

function resolveTargetLang(req: Request, requested?: unknown): TranslationLang | null {
  if (typeof requested === 'string' && ALLOWED_LANGS.has(requested as TranslationLang)) {
    return requested as TranslationLang;
  }
  const headerLang = req.headers['x-language'] || req.headers['x-nygc-language'];
  if (typeof headerLang === 'string' && ALLOWED_LANGS.has(headerLang as TranslationLang)) {
    return headerLang as TranslationLang;
  }
  return null;
}

/**
 * POST /api/translate
 * On-demand content translation with persistent SHA-256 DB caching & Gemini API provider.
 * Restricted to registered accounts (guest demo-* accounts are blocked).
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  if (isGuestAccountEmail(req.user?.email)) {
    res.status(403).json({
      error: '게스트 계정은 번역 기능을 사용할 수 없습니다. 정식 회원으로 로그인해 주세요.',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  try {
    const body = req.body || {};
    const targetLang = resolveTargetLang(req, body.targetLang);
    if (!targetLang) {
      res.status(400).json({ error: '지원하지 않는 번역 대상 언어입니다.' });
      return;
    }

    let items: TranslateItemInput[] = [];
    if (Array.isArray(body.items)) {
      items = body.items
        .filter((it: any) => it && typeof it.key === 'string' && it.key.trim().length > 0 && typeof it.text === 'string')
        .map((it: any) => ({
          key: it.key.trim(),
          text: it.text,
          format: it.format === 'html' || it.format === 'text' ? it.format : undefined,
        }));
    } else if (typeof body.text === 'string') {
      items = [
        {
          key: 'text',
          text: body.text,
          format: body.format === 'html' || body.format === 'text' ? body.format : undefined,
        },
      ];
    }

    if (items.length === 0) {
      res.status(400).json({ error: '번역할 내용이 없습니다.' });
      return;
    }

    if (items.length > MAX_BATCH_ITEMS) {
      res.status(400).json({ error: '한 번에 번역할 수 있는 항목 수를 초과했습니다.' });
      return;
    }

    const context = typeof body.context === 'string' ? body.context.slice(0, 64) : undefined;
    const response = await translateItemsBatch(items, targetLang, context);
    res.json(response);
  } catch (err: any) {
    if (err instanceof TranslationError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[Translate API Error]:', err);
    res.status(503).json({ error: '번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

/**
 * GET /api/translate/usage
 * Admin-only cumulative Gemini API translation token & estimated cost monitor.
 */
router.get('/usage', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    return;
  }
  const usage = getAdminTranslationUsage();
  res.json(usage);
});

/**
 * POST /api/translate/usage/reset
 * Admin-only reset of cumulative translation usage counters.
 */
router.post('/usage/reset', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    return;
  }
  const usage = resetAdminTranslationUsage();
  res.json(usage);
});

export default router;
