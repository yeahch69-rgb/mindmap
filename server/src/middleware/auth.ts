import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/database.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'standalone-project-journal-dev-secret-key';

export interface AuthUserPayload {
  id: number;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export function signAuthToken(user: AuthUserPayload): string {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const row = db
      .prepare('SELECT id, email, name FROM users WHERE id = ?')
      .get(Number(decoded.id)) as AuthUserPayload | undefined;

    if (!row) {
      res.status(401).json({ error: '유효하지 않은 사용자입니다.' });
      return;
    }

    req.user = {
      id: Number(row.id),
      email: row.email,
      name: row.name,
    };
    next();
  } catch {
    res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.' });
  }
}
