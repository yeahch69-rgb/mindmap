import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getJstDateStr, getJstDateStrWithDayOffset, getJstDateTimeStr, getJstTimeStr } from '../utils/jstTime.js';

const dbPathEnv = path.resolve(process.env.DB_PATH || path.join(process.cwd(), 'data', 'journal.db'));
const dbDir = path.dirname(dbPathEnv);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export function getDbPath(): string {
  return dbPathEnv;
}

let currentDb: Database.Database = new Database(dbPathEnv);
currentDb.pragma('journal_mode = WAL');
currentDb.pragma('foreign_keys = ON');

export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const val = (currentDb as any)[prop];
    if (typeof val === 'function') {
      return val.bind(currentDb);
    }
    return val;
  },
});

export function reloadDatabase(newDbPath?: string) {
  try {
    currentDb.close();
  } catch (err) {
    console.error('Error closing current db:', err);
  }

  try {
    if (fs.existsSync(`${dbPathEnv}-wal`)) fs.unlinkSync(`${dbPathEnv}-wal`);
  } catch {}
  try {
    if (fs.existsSync(`${dbPathEnv}-shm`)) fs.unlinkSync(`${dbPathEnv}-shm`);
  } catch {}

  if (newDbPath && newDbPath !== dbPathEnv) {
    fs.copyFileSync(newDbPath, dbPathEnv);
  }

  currentDb = new Database(dbPathEnv);
  currentDb.pragma('journal_mode = WAL');
  currentDb.pragma('foreign_keys = ON');
}

export function generateInviteToken(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      font_size TEXT NOT NULL DEFAULT '100',
      mobile_font_size TEXT NOT NULL DEFAULT '100',
      push_enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'SOLO', -- 'SOLO' | 'COLLAB'
      is_private INTEGER NOT NULL DEFAULT 1,
      partner_type TEXT NOT NULL DEFAULT 'NONE', -- 'NONE' | 'SHARED' | 'EXTERNAL'
      partner_name TEXT,
      invite_token TEXT UNIQUE,
      active_turn_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      participants_json TEXT DEFAULT '[]',
      intent_summary TEXT,
      initial_intent_summary TEXT,
      intent_modified INTEGER NOT NULL DEFAULT 0,
      turn_state TEXT NOT NULL DEFAULT 'MY_TURN', -- 'MY_TURN' | 'THEIR_TURN' | 'HOLD' | 'DONE'
      next_action TEXT,
      next_action_date TEXT,
      stale_threshold_days INTEGER NOT NULL DEFAULT 7,
      last_activity_at TEXT NOT NULL,
      stale_push_last_sent_at TEXT,
      color TEXT NOT NULL DEFAULT '#1B4D3E',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER', -- 'MEMBER'
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL DEFAULT 'INTENT', -- 'DIALOGUE_ME' | 'DIALOGUE_THEM' | 'INTENT' | 'PROGRESS'
      speaker_name TEXT,
      content TEXT NOT NULL,
      entry_date TEXT NOT NULL DEFAULT '',
      entry_time TEXT,
      due_date TEXT,
      due_time TEXT,
      completed_target_type TEXT, -- 'ENTRY' | 'IDEA' | NULL
      completed_target_id INTEGER,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      parent_idea_id INTEGER REFERENCES journal_ideas(id) ON DELETE CASCADE,
      related_idea_ids TEXT DEFAULT '[]',
      title TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'PROMOTED' | 'ARCHIVED'
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      linked_project_id INTEGER REFERENCES journal_projects(id) ON DELETE SET NULL,
      is_processed INTEGER NOT NULL DEFAULT 0,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_mindmap_layouts (
      project_id INTEGER PRIMARY KEY REFERENCES journal_projects(id) ON DELETE CASCADE,
      positions_json TEXT DEFAULT '{}',
      edges_json TEXT DEFAULT '[]',
      parent_overrides_json TEXT DEFAULT '{}',
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device_info TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_push_sent_log (
      dedup_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_entry_revision_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS journal_turn_waits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      watcher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wait_days INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      target_date TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_name TEXT,
      notified_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, watcher_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_journal_turn_waits_due
      ON journal_turn_waits(notified_at, target_date);
  `);

  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER';");
  }
  if (!userColNames.has('font_size')) {
    db.exec("ALTER TABLE users ADD COLUMN font_size TEXT NOT NULL DEFAULT '100';");
  }
  if (!userColNames.has('mobile_font_size')) {
    db.exec("ALTER TABLE users ADD COLUMN mobile_font_size TEXT NOT NULL DEFAULT '100';");
  }
  if (!userColNames.has('push_enabled')) {
    db.exec("ALTER TABLE users ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 1;");
  }

  const projCols = db.prepare("PRAGMA table_info(journal_projects)").all() as { name: string }[];
  const projColNames = new Set(projCols.map((c) => c.name));
  if (!projColNames.has('stale_push_last_sent_at')) {
    db.exec("ALTER TABLE journal_projects ADD COLUMN stale_push_last_sent_at TEXT;");
  }
  if (!projColNames.has('initial_intent_summary')) {
    db.exec('ALTER TABLE journal_projects ADD COLUMN initial_intent_summary TEXT;');
    db.exec('UPDATE journal_projects SET initial_intent_summary = intent_summary WHERE initial_intent_summary IS NULL AND intent_summary IS NOT NULL;');
  }
  if (!projColNames.has('intent_modified')) {
    db.exec('ALTER TABLE journal_projects ADD COLUMN intent_modified INTEGER NOT NULL DEFAULT 0;');
  }

  const entryCols = db.prepare("PRAGMA table_info(journal_entries)").all() as { name: string }[];
  const entryColNames = new Set(entryCols.map((c) => c.name));
  if (!entryColNames.has('due_date')) {
    db.exec('ALTER TABLE journal_entries ADD COLUMN due_date TEXT;');
  }
  if (!entryColNames.has('due_time')) {
    db.exec('ALTER TABLE journal_entries ADD COLUMN due_time TEXT;');
  }
}

export function seedDemoDataForUser(userId: number) {
  const today = getJstDateStr();
  const dMinus3 = getJstDateStrWithDayOffset(-3);
  const dMinus2 = getJstDateStrWithDayOffset(-2);
  const dMinus1 = getJstDateStrWithDayOffset(-1);
  const dPlus4 = getJstDateStrWithDayOffset(4);
  const dPlus7 = getJstDateStrWithDayOffset(7);
  const nowStr = getJstDateTimeStr();
  const timeNow = getJstTimeStr();

  const tx = db.transaction(() => {
    // 1. Personal Solo Long-term Project
    const p1 = db.prepare(`
      INSERT INTO journal_projects (
        title, mode, is_private, partner_type, participants_json,
        intent_summary, turn_state, active_turn_user_id, next_action, next_action_date,
        stale_threshold_days, last_activity_at, color, created_by
      )
      VALUES (?, 'SOLO', 1, 'NONE', ?, ?, 'MY_TURN', ?, ?, ?, 7, ?, '#1B4D3E', ?)
    `).run(
      '개인 사이드 프로젝트 — 맥락 기록 앱 출시',
      JSON.stringify([
        { name: '김디자이너', role: 'UI 피드백' },
        { name: '법무사', role: '약관 자문' },
      ]),
      '내가 왜 이 기능을 만들려고 했는지, 중간에 어떤 가설을 세웠는지 잊지 않기 위해 모든 의도와 아이디어를 한곳에 남긴다.',
      userId,
      '랜딩 페이지 시안 검토 후 베타 테스터 5명 모집',
      dPlus4,
      nowStr,
      userId
    );
    const p1Id = Number(p1.lastInsertRowid);

    const e1 = db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
      VALUES (?, 'INTENT', ?, ?, '09:30', ?)
    `).run(p1Id, '기능을 복잡하게 늘리기보다, "지금 누구 턴인가"와 "마인드맵 가지치기" 두 가지 경험에 집중하기로 결정.', dMinus3, userId);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, speaker_name, content, entry_date, entry_time, author_id)
      VALUES (?, 'DIALOGUE_THEM', '김디자이너', ?, ?, '15:20', ?)
    `).run(p1Id, '첫 화면에서 너무 많은 버튼이 보이면 압도될 수 있으니 자유 마인드맵의 연결점은 모드 활성화 시에만 띄우는 게 좋겠다고 피드백함.', dMinus2, userId);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
      VALUES (?, 'DIALOGUE_ME', ?, ?, '16:05', ?)
    `).run(p1Id, '동의함. [노드 연결] / [노드 종속] 토글 버튼으로 분리해서 평소에는 깔끔하게 유지하고 반영하겠다고 회신.', dMinus2, userId);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, completed_target_type, completed_target_id, author_id)
      VALUES (?, 'PROGRESS', ?, ?, ?, 'ENTRY', ?, ?)
    `).run(p1Id, '핵심 턴 트래커 + 자유 마인드맵 프로토타입 구현 완료.', dMinus1, timeNow, Number(e1.lastInsertRowid), userId);

    const i1 = db.prepare(`
      INSERT INTO journal_ideas (project_id, title, note, status, author_id)
      VALUES (?, ?, ?, 'OPEN', ?)
    `).run(p1Id, '초대 링크 기반 협업 모드', '사내 계정이 없어도 링크 하나로 프로젝트에 참여해 턴을 주고받기', userId);
    const i1Id = Number(i1.lastInsertRowid);

    const i2 = db.prepare(`
      INSERT INTO journal_ideas (project_id, parent_idea_id, related_idea_ids, title, note, status, author_id)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(p1Id, i1Id, JSON.stringify([]), '외부인용 관계자 프리셋', '가입하지 않는 거래처/가족도 원클릭으로 발언자 기록', userId);
    const i2Id = Number(i2.lastInsertRowid);

    const i3 = db.prepare(`
      INSERT INTO journal_ideas (project_id, title, note, status, author_id)
      VALUES (?, ?, ?, 'PROMOTED', ?)
    `).run(p1Id, '베타 테스터 피드백 설문 정리', '온보딩 흐름이 직관적인지 확인', userId);
    const i3Id = Number(i3.lastInsertRowid);

    // Cross-link i2 <-> i3
    db.prepare('UPDATE journal_ideas SET related_idea_ids = ? WHERE id = ?').run(JSON.stringify([i3Id]), i2Id);
    db.prepare('UPDATE journal_ideas SET related_idea_ids = ? WHERE id = ?').run(JSON.stringify([i2Id]), i3Id);

    // 2. External Collaboration Project
    const p2 = db.prepare(`
      INSERT INTO journal_projects (
        title, mode, is_private, partner_type, partner_name, invite_token,
        participants_json, intent_summary, turn_state, active_turn_user_id,
        next_action, next_action_date, stale_threshold_days, last_activity_at, color, created_by
      )
      VALUES (?, 'COLLAB', 1, 'EXTERNAL', '박대표 (거래처)', ?, ?, ?, 'THEIR_TURN', NULL, ?, ?, 5, ?, '#0369A1', ?)
    `).run(
      '외부 파트너 공동 계약 협의',
      generateInviteToken(),
      JSON.stringify([
        { name: '박대표 (거래처)', role: '의사결정권자' },
        { name: '이팀장', role: '실무 담당' },
      ]),
      '유지보수 범위와 분기별 정산 조건을 명확히 합의해 추후 분쟁 여지를 없앤다.',
      '수정 계약서 초안 회신 확인 (금요일까지 미회신 시 리마인드)',
      dPlus7,
      nowStr,
      userId
    );
    const p2Id = Number(p2.lastInsertRowid);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
      VALUES (?, 'DIALOGUE_ME', ?, ?, '11:10', ?)
    `).run(p2Id, '1차 견적 및 SLA 기준안을 메일로 송부하고 검토 요청드림.', dMinus1, userId);

    // 3. Quick Inbox Note
    db.prepare(`
      INSERT INTO journal_inbox (content, author_id)
      VALUES (?, ?)
    `).run('다음 미팅 전에 마인드맵에 비용 항목 가지 하나 더 뻗어서 시뮬레이션해보기', userId);

    void today;
  });

  tx();
}
