import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, seedDemoDataForUser } from '../db/database.js';
import { authenticateToken, signAuthToken } from '../middleware/auth.js';

const router = Router();

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

    const hash = bcrypt.hashSync(cleanPassword, 10);
    const info = db
      .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(cleanEmail, hash, cleanName);

    const userId = Number(info.lastInsertRowid);
    const userPayload = { id: userId, email: cleanEmail, name: cleanName };
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
      .prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
      .get(cleanEmail) as any;

    if (!userRow || !bcrypt.compareSync(cleanPassword, userRow.password_hash)) {
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }

    const userPayload = {
      id: Number(userRow.id),
      email: userRow.email,
      name: userRow.name,
    };
    const token = signAuthToken(userPayload);
    res.json({ token, user: userPayload });
  } catch (err: any) {
    res.status(500).json({ error: '로그인 실패: ' + err.message });
  }
});

router.post('/demo', (_req: Request, res: Response) => {
  try {
    const suffix = crypto.randomBytes(3).toString('hex');
    const email = `demo-${suffix}@journal.local`;
    const name = `게스트 (${suffix.toUpperCase()})`;
    const hash = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 8);

    const info = db
      .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email, hash, name);
    const userId = Number(info.lastInsertRowid);
    seedDemoDataForUser(userId);

    const userPayload = { id: userId, email, name };
    const token = signAuthToken(userPayload);
    res.status(201).json({ token, user: userPayload });
  } catch (err: any) {
    res.status(500).json({ error: '데모 계정 생성 실패: ' + err.message });
  }
});

router.get('/me', authenticateToken, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export default router;
