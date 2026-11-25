import { Router, Request, Response } from 'express';
import { db } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { getPublicVapidKey, sendPushToUsers } from '../utils/webPush.js';

const router = Router();

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: getPublicVapidKey() });
});

router.get('/status', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const countRow = db
    .prepare('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE user_id = ?')
    .get(userId) as { cnt: number };
  const userRow = db
    .prepare('SELECT COALESCE(push_enabled, 1) as push_enabled FROM users WHERE id = ?')
    .get(userId) as { push_enabled: number } | undefined;

  res.json({
    subscribedCount: Number(countRow?.cnt || 0),
    pushEnabled: Boolean(userRow?.push_enabled ?? 1),
  });
});

router.post('/subscribe', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const { subscription, deviceInfo, language } = req.body || {};

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    res.status(400).json({ error: '유효한 푸시 구독 정보가 필요합니다.' });
    return;
  }

  const reqLang = String(language || req.headers['x-language'] || '').toLowerCase();
  if (reqLang === 'ko' || reqLang === 'ja' || reqLang === 'en') {
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(reqLang, userId);
  }

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_info, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      device_info = excluded.device_info,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    userId,
    String(subscription.endpoint),
    String(subscription.keys.p256dh),
    String(subscription.keys.auth),
    typeof deviceInfo === 'string' ? deviceInfo.slice(0, 300) : req.headers['user-agent'] || 'Web Browser'
  );

  res.json({ success: true });
});

router.post('/unsubscribe', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
  } else {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  }
  res.json({ success: true });
});

router.post('/test', authenticateToken, async (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const sent = await sendPushToUsers([userId], {
    title: '🔔 프로젝트 마인드맵 알림 테스트',
    body: `${req.user!.name}님, 웹 푸시 알림이 정상적으로 연결되었습니다!`,
    url: '/',
    tag: 'mindmap-test',
  });

  if (sent === 0) {
    res.status(400).json({
      error: '현재 계정에 등록된 활성 푸시 구독이 없습니다. 먼저 알림 허용을 켜주세요.',
    });
    return;
  }
  res.json({ success: true, sent });
});

export default router;
