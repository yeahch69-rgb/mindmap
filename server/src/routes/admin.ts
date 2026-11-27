import { Router, Request, Response } from 'express';
import { db } from '../db/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import {
  getNygcShiftSyncAdminView,
  runNygcShiftSync,
  updateNygcShiftSyncConfig,
} from '../services/nygcShiftSync.js';

const router = Router();

router.use(authenticateToken, requireAdmin);

router.get('/users', (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          u.id,
          u.email,
          u.name,
          COALESCE(u.role, 'USER') AS role,
          COALESCE(u.font_size, '100') AS font_size,
          COALESCE(u.mobile_font_size, '100') AS mobile_font_size,
          COALESCE(u.push_enabled, 1) AS push_enabled,
          u.created_at,
          (
            SELECT COUNT(*)
            FROM journal_projects p
            WHERE p.created_by = u.id
               OR EXISTS (
                 SELECT 1 FROM journal_project_members m
                 WHERE m.project_id = p.id AND m.user_id = u.id
               )
          ) AS project_count,
          (
            SELECT COUNT(*)
            FROM push_subscriptions s
            WHERE s.user_id = u.id
          ) AS push_device_count
        FROM users u
        ORDER BY
          CASE WHEN COALESCE(u.role, 'USER') = 'ADMIN' THEN 0 ELSE 1 END,
          u.created_at DESC,
          u.id DESC
      `)
      .all() as any[];

    const users = rows.map((r) => ({
      id: Number(r.id),
      email: r.email,
      name: r.name,
      role: r.role === 'ADMIN' ? 'ADMIN' : 'USER',
      fontSize: String(r.font_size || '100'),
      mobileFontSize: String(r.mobile_font_size || '100'),
      pushEnabled: Boolean(r.push_enabled ?? 1),
      projectCount: Number(r.project_count || 0),
      pushDeviceCount: Number(r.push_device_count || 0),
      isDemo: String(r.email || '').startsWith('demo-') && String(r.email || '').endsWith('@mindmap.local'),
      createdAt: r.created_at,
    }));

    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: '회원 목록 조회 실패: ' + err.message });
  }
});

router.patch('/users/:id/role', (req: Request, res: Response) => {
  const targetId = Number(req.params.id);
  const nextRole = req.body?.role === 'ADMIN' ? 'ADMIN' : req.body?.role === 'USER' ? 'USER' : null;

  if (!Number.isInteger(targetId) || targetId <= 0 || !nextRole) {
    res.status(400).json({ error: '유효한 사용자와 권한을 지정해주세요.' });
    return;
  }

  if (targetId === Number(req.user!.id) && nextRole !== 'ADMIN') {
    res.status(400).json({ error: '현재 로그인한 본인 관리자 계정의 권한은 해제할 수 없습니다.' });
    return;
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!existing) {
      res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      return;
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nextRole, targetId);
    res.json({ success: true, id: targetId, role: nextRole });
  } catch (err: any) {
    res.status(500).json({ error: '권한 변경 실패: ' + err.message });
  }
});

// NYGC Shift Sync Admin Settings (strictly ADMIN only via router.use above)
router.get('/nygc-shift-sync', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(getNygcShiftSyncAdminView());
  } catch (err: any) {
    res.status(500).json({ error: 'NYGC 시프트 연동 설정 조회 실패: ' + err.message });
  }
});

router.put('/nygc-shift-sync', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = updateNygcShiftSyncConfig({
      enabled: req.body?.enabled,
      feedUrl: req.body?.feedUrl,
      feedToken: req.body?.feedToken,
      clearToken: Boolean(req.body?.clearToken),
      enabledSpaceIds: req.body?.enabledSpaceIds,
      syncIntervalMinutes: req.body?.syncIntervalMinutes,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error || '설정을 저장할 수 없습니다.' });
      return;
    }
    res.json({ success: true, ...result.view });
  } catch (err: any) {
    res.status(500).json({ error: 'NYGC 시프트 연동 설정 저장 실패: ' + err.message });
  }
});

router.post('/nygc-shift-sync/sync-now', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await runNygcShiftSync('manual');
    const view = getNygcShiftSyncAdminView();
    if (!result.ok) {
      res.status(400).json({
        success: false,
        error: result.error || '동기화에 실패했습니다.',
        result,
        ...view,
      });
      return;
    }
    res.json({
      success: true,
      result,
      ...view,
    });
  } catch (err: any) {
    res.status(500).json({ error: '수동 동기화 실패: ' + err.message });
  }
});

export default router;
