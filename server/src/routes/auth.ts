import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, seedDemoDataForUser } from '../db/database.js';
import { authenticateToken, signAuthToken } from '../middleware/auth.js';

const router = Router();

function getAdminEmailsSet(): Set<string> {
  const list = [process.env.ADMIN_EMAIL, process.env.ADMIN_EMAILS]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

export function ensureAdminAccount() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
  const adminPassword = process.env.ADMIN_PASSWORD?.trim() || '';
  const adminName = process.env.ADMIN_NAME?.trim() || '관리자';
  const adminEmails = getAdminEmailsSet();

  for (const email of adminEmails) {
    const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email) as
      | { id: number; role: string }
      | undefined;

    if (existing) {
      if (existing.role !== 'ADMIN') {
        db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(existing.id);
        console.log(`🛡️ [Admin] Promoted existing account to ADMIN: ${email}`);
      }
      if (email === adminEmail && adminPassword) {
        const hash = bcrypt.hashSync(adminPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
      }
    } else if (email === adminEmail && adminPassword) {
      const hash = bcrypt.hashSync(adminPassword, 10);
      db.prepare(
        "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'ADMIN')"
      ).run(email, hash, adminName);
      console.log(`🛡️ [Admin] Created ADMIN account: ${email}`);
    }
  }
}

function formatUser(row: any) {
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    role: (row.role === 'ADMIN' ? 'ADMIN' : 'USER') as 'USER' | 'ADMIN',
    fontSize: String(row.font_size || '100'),
    mobileFontSize: String(row.mobile_font_size || '100'),
    pushEnabled: Boolean(row.push_enabled ?? 1),
  };
}

function clampFontScaleStr(raw: unknown): string {
  const parsed = Number(String(raw ?? '100').replace('%', ''));
  if (!Number.isFinite(parsed)) return '100';
  const clamped = Math.min(150, Math.max(80, Math.round(parsed / 5) * 5));
  return String(clamped);
}

router.post('/register', (req: Request, res: Response) => {
  const { email, password, name } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
    return;
  }
  if (!cleanName || cleanName.length < 1) {
    res.status(400).json({ error: '이름(표시명)을 입력해주세요.' });
    return;
  }
  if (cleanPassword.length < 6) {
    res.status(400).json({ error: '비밀번호는 최소 6자 이상이어야 합니다.' });
    return;
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: '이미 가입된 이메일입니다.' });
      return;
    }

    const assignedRole = getAdminEmailsSet().has(cleanEmail) ? 'ADMIN' : 'USER';
    const hash = bcrypt.hashSync(cleanPassword, 10);
    const info = db
      .prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(cleanEmail, hash, cleanName, assignedRole);

    const userRow = db
      .prepare('SELECT id, email, name, role, font_size, mobile_font_size, push_enabled FROM users WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    const userPayload = formatUser(userRow);
    const token = signAuthToken(userPayload);

    res.status(201).json({ token, user: userPayload });
  } catch (err: any) {
    res.status(500).json({ error: '회원가입 실패: ' + err.message });
  }
});

router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanEmail || !cleanPassword) {
    res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    return;
  }

  try {
    const userRow = db
      .prepare('SELECT id, email, name, role, password_hash, font_size, mobile_font_size, push_enabled FROM users WHERE email = ?')
      .get(cleanEmail) as any;

    if (!userRow || !bcrypt.compareSync(cleanPassword, userRow.password_hash)) {
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }

    const userPayload = formatUser(userRow);
    const token = signAuthToken(userPayload);
    res.json({ token, user: userPayload });
  } catch (err: any) {
    res.status(500).json({ error: '로그인 실패: ' + err.message });
  }
});

router.post('/demo', (_req: Request, res: Response) => {
  try {
    const suffix = crypto.randomBytes(3).toString('hex');
    const email = `demo-${suffix}@mindmap.local`;
    const name = `게스트 (${suffix.toUpperCase()})`;
    const hash = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 8);

    const info = db
      .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email, hash, name);
    const userId = Number(info.lastInsertRowid);
    seedDemoDataForUser(userId);

    const userRow = db
      .prepare('SELECT id, email, name, role, font_size, mobile_font_size, push_enabled FROM users WHERE id = ?')
      .get(userId);
    const userPayload = formatUser(userRow);
    const token = signAuthToken(userPayload);
    res.status(201).json({ token, user: userPayload });
  } catch (err: any) {
    res.status(500).json({ error: '데모 계정 생성 실패: ' + err.message });
  }
});

router.get('/me', authenticateToken, (req: Request, res: Response) => {
  const refreshedToken = signAuthToken(req.user!);
  res.json({ user: req.user, refreshedToken });
});

router.patch('/preferences', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const { name, fontSize, mobileFontSize, pushEnabled } = req.body || {};

  try {
    const current = db
      .prepare('SELECT id, email, name, role, font_size, mobile_font_size, push_enabled FROM users WHERE id = ?')
      .get(userId) as any;
    if (!current) {
      res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      return;
    }

    const nextName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : current.name;
    const nextFontSize = fontSize !== undefined ? clampFontScaleStr(fontSize) : current.font_size;
    const nextMobileFontSize =
      mobileFontSize !== undefined ? clampFontScaleStr(mobileFontSize) : current.mobile_font_size;
    const nextPushEnabled =
      pushEnabled !== undefined ? (pushEnabled ? 1 : 0) : Number(current.push_enabled ?? 1);

    db.prepare(`
      UPDATE users
      SET name = ?, font_size = ?, mobile_font_size = ?, push_enabled = ?
      WHERE id = ?
    `).run(nextName, nextFontSize, nextMobileFontSize, nextPushEnabled, userId);

    const updated = db
      .prepare('SELECT id, email, name, role, font_size, mobile_font_size, push_enabled FROM users WHERE id = ?')
      .get(userId);

    res.json({ user: formatUser(updated) });
  } catch (err: any) {
    res.status(500).json({ error: '프로필 설정 저장 실패: ' + err.message });
  }
});

export default router;
